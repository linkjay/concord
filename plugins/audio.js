'use strict';

var commands = require( '../commands.js' );
var permissions = require( '../permissions.js' );
var settings = require( '../settings.js' );
var _ = require( '../helper.js' );

var ytdl = require( 'ytdl-core' );
var moment = require( 'moment' );
require( 'moment-duration-format' );

var sessions = {};

function join( msg )
{
	var promise = new Promise( function( resolve, reject )
		{
			var channel = msg.member.getVoiceChannel();
				
			if ( !channel )
				return reject( 'you are not in a voice channel' );
			
			if ( !client.User.can( permissions.discord.Voice.CONNECT, channel ) || 
				 !client.User.can( permissions.discord.Voice.SPEAK, channel ) ||
				 !client.User.can( permissions.discord.Voice.USE_VAD, channel ) )
					return reject( _.fmt( "invalid permissions for `%s`", channel.name ) );
				
			if ( channel.guild.id in sessions )
			{
				var sess = sessions[ channel.guild.id ];
				
				var disposed = sess.conn.disposed;
				var samechan = sess.channel == channel.id;
				
				if ( !disposed && !samechan )
					return reject( 'already busy in another channel' );
				else if ( !disposed && samechan )
					return resolve( { isnew: false, conn: sess.conn } );
			}
			
			msg.member.getVoiceChannel().join().then( conn => resolve( { isnew: true, conn: conn } ) )
				.catch( e => reject( e.message ) );
		});
	
	return promise;
}

function parse_seek( str )
{
	var time = str.match( '(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?' );
	var hours = parseInt( time[0] || 0 ) * 60 * 60;
	var minutes = parseInt( time[1] || 0 ) * 60;
	var seconds = parseInt( time[2] || 0 );
	return hours + minutes + seconds;
}

function rotate_queue( id )
{
	var sess = sessions[ id ];
	if ( sess.playing )
	{
		sess.encoder.stop();
		sess.playing = false;
	}
	
	var song = sess.queue.shift();
	console.log( 'playing ' + song.url );
	
	var encoder = sess.conn.createExternalEncoder(
		{
			type: 'ffmpeg',
			source: song.streamurl,
			format: 'opus',
			//frameDuration: 60,
			inputArgs: [ '-ss', '00:09:30' ],
			outputArgs: [ '-af', 'volume=0.3' ]
		});
		
	if ( !encoder )
		return console.log( 'Voice connection is disposed' );
	
	encoder.once( 'end', () => console.log( 'stream end' ) );

	var encoderStream = encoder.play();
	encoderStream.resetTimestamp();
	encoderStream.removeAllListeners( 'timestamp' );
	//encoderStream.on( 'timestamp', time => console.log( 'Time ' + time ) );
}

function queryRemote( msg, url )
{
	var promise = new Promise( function( resolve, reject )
		{
			function parseInfo( err, info )
			{
				if ( err )
					return reject( _.fmt( 'youtube error: `%s`', err ) );
				
				var title = info.title;
				var length = info.length_seconds;
				
				var length_pretty = '';
				if ( length )
					length_pretty = moment.duration( length*1000 ).format( 'h:mm:ss' );
				
				var max_length = settings.get( 'audio', 'max_length', 62 );
				if ( length && length > max_length * 60 )
				{
					var maxlen = moment.duration( max_length*1000 ).format( 'h:mm:ss' );
					return reject( _.fmt( 'song exceeds max length: %s > %s', length_pretty, maxlen ) );
				}
				
				var formats = info.formats.filter( f => f.container === 'webm' ).sort( (a, b) => b.audioBitrate - a.audioBitrate );
				var bestaudio = formats.find( f => f.audioBitrate > 0 && !f.bitrate ) || formats.find( f => f.audioBitrate > 0 );
				if ( !bestaudio )
					return reject( 'could not find suitable audio format' );
				
				var seek = false;
				if ( url.indexOf( 't=' ) != -1 )
					seek = parse_seek( url.match( 't=(.*)' )[0] );
				
				var id = msg.guild.id;
				if ( !sessions[ id ].queue )
					sessions[ id ].queue = [];
				sessions[ id ].queue.push( { url: url, title: title, length: length, queuedby: msg.author.id, seek: seek, streamurl: bestaudio.url } );
				
				if ( sessions[ id ].queue.length == 1 )
				{
					resolve( _.fmt( '%s started playing %s [%s]', msg.author.username, title, length_pretty ) );
					rotate_queue( id );
				}
				else
					resolve( _.fmt( '%s queued %s [%s]', msg.author.username, title, length_pretty ) );
			}
			
			ytdl.getInfo( url, parseInfo );
		});
		
	return promise;
}

commands.register( {
	aliases: [ 'test' ], // 'play', 'p', 
	help: 'play audio from a url',
	args: 'url',
	callback: ( client, msg, args ) =>
	{
		var acceptedURLs = settings.get( 'audio', 'accepted_urls' );
		
		var found = false;
		for ( var i in acceptedURLs )
			if ( args.match( acceptedURLs[i] ) )
				found = true;
				
		if ( !found )
			return msg.channel.sendMessage( _.fmt( '`%s` is not an accepted url', args ) );
		
		join( msg ).then( res =>
			{
				if ( res.isnew )
				{
					var channel = msg.member.getVoiceChannel();
					sessions[ msg.guild.id ] = { conn: res.conn.voiceConnection, channel: channel.id };
				}
				
				queryRemote( msg, args ).then( s => msg.channel.sendMessage( s ) ).catch( s => msg.channel.sendMessage( s ) );
				//setTimeout( function() { msg.member.getVoiceChannel().leave() }, 3000 );
			})
			.catch( e => { if ( e.message ) throw e; msg.channel.sendMessage( e ); } );
	}});

var client = null;
module.exports.setup = function( _cl )
	{
		client = _cl;
		console.log( 'audio plugin loaded' );
	};