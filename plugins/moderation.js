let client = null
const Discord = require( 'discord.js' )

const commands = require( '../commands.js' )
const permissions = require( '../permissions.js' )
const settings = require( '../settings.js' )
const _ = require( '../helper.js' )

function clearMessages( args )
{
	let limit = parseInt( args.limit )
	const msg = args.msg
	const after = args.after
	const target = args.target
	const regex = args.regex

	if ( !msg.channel.permissionsFor( client.user ).has( Discord.Permissions.FLAGS.MANAGE_MESSAGES ) )
		return msg.channel.send( "invalid 'manage messages' permission in this channel" )

	const maxLimit = 100
	if ( !limit )
		limit = maxLimit
	if ( isNaN( limit ) )
		return msg.channel.send( `\`${ limit }\` is not a number` )
	if ( limit > maxLimit )
		return msg.channel.send( `\`${ limit }\` exceeds maximum deletions per command of \`${ maxLimit }\`` )

	let fetchLimit = limit
	if ( regex || target )
		fetchLimit = maxLimit

	msg.channel.messages.fetch(
			{
				limit: fetchLimit,
				after: after,
			})
		.then( messages =>
			{
				
				const toDelete = []
				messages.forEach( m =>
					{
						if ( toDelete.length >= limit )
							return

						if ( target && m.author.id !== target.id )
							return

						if ( regex && !m.content.match( regex ) )
							return

						toDelete.push( m )
					})

				msg.channel.bulkDelete( toDelete )
					.then( deleted =>
						{
							let suffix = ''
							if ( target )
								suffix = ` by \`${ _.nick( target, msg.guild ) }\``
							if ( regex )
								suffix += ` matching \`${ regex.toString() }\``
							msg.channel.send( `\`${ _.nick( msg.member, msg.guild ) }\` cleared \`${ deleted.size }\` messages${ suffix }` )
						})
					.catch( e => msg.channel.send( _.fmt( 'error deleting messages: `%s`', e.message ) ) )
			})
		.catch( e => msg.channel.send( _.fmt( 'error fetching messages: `%s`', e.message ) ) )
}

commands.register( {
	category: 'moderation',
	aliases: [ 'clear' ],
	help: 'clear a number of messages',
	flags: [ 'admin_only', 'no_pm' ],
	args: 'limit',
	callback: ( client, msg, args ) =>
	{
		const limit = parseInt( args ) + 1
		clearMessages( { msg: msg, limit: limit } )
	} })

commands.register( {
	category: 'moderation',
	aliases: [ 'clearuser' ],
	help: 'clear messages by a specific user',
	flags: [ 'admin_only', 'no_pm' ],
	args: 'user [limit=100]',
	callback: ( client, msg, args ) =>
	{
		const split = args.split( ' ' )
		let target = split[0]
		let limit = split[1] || false

		target = commands.findTarget( msg, target )
		if ( !target )
			return

		if ( target.id === msg.author.id )
			limit++
		
		clearMessages( { msg: msg, limit: limit, target: target } )
	} })

commands.register( {
	category: 'moderation',
	aliases: [ 'clearafter' ],
	help: 'clear messages after a message ID',
	flags: [ 'admin_only', 'no_pm' ],
	args: 'messageID [limit=100]',
	callback: ( client, msg, args ) =>
	{
		const split = args.split( ' ' )
		const after = split[0]
		const limit = split[1] || false
		
		if ( isNaN( after ) )
			return msg.channel.send( _.fmt( '`%s` is not a numeric message ID', after ) )
		
		clearMessages( { msg: msg, limit: limit, after: after } )
	} })

commands.register( {
	category: 'moderation',
	aliases: [ 'clearmatches' ],
	help: 'clear messages that match a regex string',
	flags: [ 'admin_only', 'no_pm' ],
	args: 'regex [limit=100]',
	callback: ( client, msg, args ) =>
	{
		const split = args.split( ' ' )
		const str = split[0]
		const limit = split[1] || false
		
		let regex = false
		try
		{
			const parts = str.match( /^\/(.*?)\/([gimy]*)$/ )
			if ( parts )
				regex = new RegExp( parts[1], parts[2] )
			else
				regex = new RegExp( str )
		} catch(e){}

		if ( !regex )
			return msg.channel.send( `\`${ str }\` is not valid regex` )
		
		clearMessages( { msg: msg, limit: limit, regex: regex } )
	} })

const tempBlacklists = {}
const tempBlacklistDelay = 10 * 1000
function updateTempBlacklists()
{
	for ( const uid in tempBlacklists )
	{
		if ( _.time() > tempBlacklists[uid] )
		{
			delete tempBlacklists[uid]
			
			const index = commands.tempBlacklist.indexOf( uid )
			commands.tempBlacklist.splice( index, 1 )
		}
	}
	
	setTimeout( updateTempBlacklists, tempBlacklistDelay )
}

const nextWarning = {}
const eventAllowance = {}
const lastEvent = {}
function processCooldown( member )
{
	if ( permissions.isOwner( member ) ) return
	if ( permissions.hasAdmin( member ) && settings.get( 'moderation', 'cooldown_admin_immunity', false ) ) return
	if ( commands.tempBlacklist.includes( member.id ) ) return
	if ( commands.blacklistedUsers.includes( member.id ) ) return
	
	const guild = member.guild

	let user = member
	if ( member.user )
		user = member.user
	
	const timespan = settings.get( 'moderation', 'cooldown_timespan', 10 ) * 1000
	const warning = settings.get( 'moderation', 'cooldown_warning_ratio', 1.5 )
	const rate = settings.get( 'moderation', 'cooldown_rate', 3.5 )
	
	if ( !eventAllowance[ user.id ] )
		eventAllowance[ user.id ] = rate
	
	if ( !lastEvent[ user.id ] )
		lastEvent[ user.id ] = Date.now()
	
	const time_passed = Date.now() - lastEvent[ user.id ]
	lastEvent[ user.id ] = Date.now()
	eventAllowance[ user.id ] += time_passed * ( rate / timespan )
	eventAllowance[ user.id ] -= 1
	
	if ( eventAllowance[ user.id ] > rate )
		eventAllowance[ user.id ] = rate
	
	if ( eventAllowance[ user.id ] < 1 )
	{
		delete eventAllowance[ user.id ]
		
		commands.tempBlacklist.push( user.id )
		tempBlacklists[ user.id ] = _.time() + settings.get( 'moderation', 'cooldown_blacklist_time', 60 )
		user.createDM().then( dm => dm.send( _.fmt( '**NOTICE:** You have been temporarily blacklisted due to excess spam' ) ) )
		
		const owner = client.users.get( settings.get( 'config', 'owner_id', '' ) )
		if ( owner )
			owner.createDM().then( d => d.send( _.fmt( '**NOTICE:** Automatically added `%s#%s` to temporary blacklist for spam', user.username, user.discriminator ) ) )
	}
	else if ( eventAllowance[ user.id ] <= warning )
	{
		if ( !nextWarning[ user.id ] || Date.now() >= nextWarning[ user.id ] )
		{
			nextWarning[ user.id ] = Date.now() + timespan / 2
			user.createDM().then( dm => dm.send( _.fmt( '**WARNING:** Potential spam detected. Please slow down or you will be temporarily blacklisted' ) ) )
		}
	}
}
module.exports.processCooldown = processCooldown

module.exports.setup = _cl => {
    client = _cl
    updateTempBlacklists()
    _.log( 'loaded plugin: moderation' )
}
