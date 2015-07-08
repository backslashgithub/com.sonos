"use strict";

var sonos			= require('sonos');

var speakers = [];
	
var self = module.exports;

self.init = function( devices, callback ){
		
	sonos
		.search()
		.on('DeviceAvailable', function(device){
		
			device.deviceDescription(function(err, metadata){
				if( err ) return;
				
				speakers.push({
					name: metadata.roomName + ' (' + metadata.displayName + ')',
					data: {
						id: metadata.UDN, //metadata.serialNum,
						host: device.host,
						port: device.port
					}
				});
				
			})
			
		})
	
	// we're ready
	callback();
}

self.capabilities = {
	radio: {
		get: function( device, name, callback ){
			
		},
		set: function( device, name, callback ){
			
		}
	}
}
	
self.pair = {
	list_devices: function( callback, emit, data ) {
		console.log('devices');			
		callback( speakers );							
	}
}