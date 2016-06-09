'use strict';

var crashlog = './crash.log';

var Discordie = require( 'discordie' );
var fs = require( 'fs' );

var settings = require( './settings.js' );
var _ = require( './helper.js' );

var client = new Discordie( { autoReconnect: true } );
client.connect( { token: settings.get( 'config', 'login_token' ) } );

client.Dispatcher.on( 'GATEWAY_READY', e =>
	{
		console.log( _.fmt( 'logged in as %s <@%s>', client.User.username, client.User.id ) );
		require('./permissions.js').init( client );
		require('./commands.js').init( client );
		require('./plugins.js').load( client );
		console.log( 'bot is ready!' );
		
		if ( fs.existsSync( crashlog ) )
		{
			var log = require('fs').readFileSync( crashlog, 'utf8' );
			var owner = client.Users.get( settings.get( 'config', 'owner_id' ) );
			if ( owner )
				owner.openDM().then( d => d.sendMessage( _.fmt( '```\n%s\n```', log ) ) );
			fs.unlinkSync( crashlog );
		}
	});

client.Dispatcher.onAny( ( type, e ) =>
	{
		if ( [ 'GATEWAY_RESUMED', 'DISCONNECTED', 'GUILD_UNAVAILABLE', 'GUILD_CREATE', 'GUILD_DELETE', 'CHANNEL_DELETE' ].indexOf( type ) != -1 )
			return console.log('<' + type + '> ' + (e.error || '') );
	});

process.on('uncaughtException', err =>
	{
		fs.writeFileSync( crashlog, err.stack, 'utf8' );
		console.error( err.stack );
		process.exit( 1 );
	});
