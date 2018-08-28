let client = null
const Discord = require( 'discord.js' )

const commands = require( '../commands.js' )
const permissions = require( '../permissions.js' )
const settings = require( '../settings.js' )
const _ = require( '../helper.js' )

const moderation = require( './moderation.js' )

let guildChannels = {}
function initGuilds()
{
	guildChannels = settings.get( 'notices', 'guild_channels', {} )
}

commands.register( {
	category: 'notices',
	aliases: [ 'notices' ],
	help: 'toggle notice output in this text channel',
	flags: [ 'admin_only', 'no_pm' ],
	args: 'on|off',
	callback: ( client, msg, args ) =>
	{
		const guildId = msg.guild.id
		
		if ( args === 'on' )
		{
			guildChannels[ guildId ] = msg.channel.id
			msg.channel.send( _.fmt( 'notices enabled for %s', msg.channel.name ) )
		}
		else if ( args === 'off' )
		{
			delete guildChannels[ guildId ]
			msg.channel.send( _.fmt( 'notices disabled for %s', msg.channel.name ) )
		}
		
		settings.set( 'notices', 'guild_channels', guildChannels )
	} })

const guildNotices = {}
let batchDelay = 5 * 1000
function batchTick()
{
	for ( const guildId in guildNotices )
	{
		if ( guildNotices[ guildId ].length === 0 )
			continue

		const channel = client.channels.get( guildChannels[ guildId ] )
		if ( !channel )
		{
			delete guildChannels[ guildId ]
			settings.set( 'notices', 'guild_channels', guildChannels )
			_.log( _.fmt( 'ERROR: tried to send notice to invalid channel %s in %s', guildChannels[ guildId ], guildId ) )
			continue
		}

		const message = guildNotices[ guildId ].join( '\n' )
		channel.send( message )

		guildNotices[ guildId ] = []
	}

	setTimeout( batchTick, batchDelay )
}

function sendGuildNotice( guildId, message, member )
{
	if ( guildId in guildChannels )
	{
		if ( !guildNotices[ guildId ] )
			guildNotices[ guildId ] = []

		guildNotices[ guildId ].push( message )
	}
}
module.exports.sendGuildNotice = sendGuildNotice

function execGlobalUserNotice( userId, callback )
{
	const user = client.users.get( userId )
	if ( !user )
		return _.log( _.fmt( 'WARNING: tried to send global notice about invalid user %s', userId ) )
		
	for ( const guildId in guildChannels )
	{
		const guild = client.guilds.get( guildId )
		
		if ( !guild )
		{
			delete guildChannels[ guildId ]
			settings.set( 'notices', 'guild_channels', guildChannels )
			_.log( _.fmt( 'WARNING: tried to send global notice to invalid guild %s', guildId ) )
			return
		}
		
		const member = guild.members.get( user.id )
		if ( member )
		{
			const message = callback( member )
			if ( message )
				sendGuildNotice( guildId, message, member )
		}
	}
}
module.exports.execGlobalUserNotice = execGlobalUserNotice

const noticeSuppressions = []
function suppressNotice( guildId, type, memberId )
{
	const sup = {}
	sup.guildId = guildId
	sup.memberId = memberId
	sup.type = type
	noticeSuppressions.push( sup )
}
module.exports.suppressNotice = suppressNotice

function isSuppressed( type, member, guild )
{
	if ( guild )
		for ( const i in noticeSuppressions )
			if ( noticeSuppressions[i].guildId === guild.id &&
				 noticeSuppressions[i].type === type )
			{
				if ( member && noticeSuppressions[i].memberId && noticeSuppressions[i].memberId !== member.id )
					continue
				
				delete noticeSuppressions[i]
				return true
			}

	return false
}

function voiceStateUpdate( oldState, newState )
{
	const guild = newState.guild
	const member = guild.members.get( oldState.id )
	if ( member.user.bot )
		return

	if ( isSuppressed( 'voiceStateUpdate', member, guild ) )
		return

	const newChannel = guild.channels.get( newState.channelID )

	if ( !oldState.channelID && newState.channelID )
		sendGuildNotice( guild.id, `\`${ _.nick( member, guild ) }\` connected to \`${ newChannel.name }\``, member )

	else if ( oldState.channelID && !newState.channelID )
		sendGuildNotice( guild.id, `\`${ _.nick( member, guild ) }\` disconnected`, member )

	else if ( oldState.channelID && newState.channelID && oldState.channelID !== newState.channelID )
		sendGuildNotice( guild.id, `\`${ _.nick( member, guild ) }\` switched to \`${ newChannel.name }\``, member )
}

module.exports.setup = _cl => {
    client = _cl
    initGuilds()
	batchDelay = settings.get( 'notices', 'batch_freq', 5 ) * 1000
	batchTick()
	
	client.on( 'voiceStateUpdate', voiceStateUpdate )

    _.log( 'loaded plugin: notices' )
}
