'use strict';

const events = require('events');
const sonos = require('sonos');

const icons = [
	'S1', // Play:1
	'S3', // Play:3
	'S5', // Play:5
	'S9', // Playbar
	'ZP100',
	'ZP120', // Connect:Amp
	'ZP90', // Connect
//	'SUB'
];

class Driver extends events.EventEmitter {

	constructor() {
		super();

		this._devices = {};
		this._searchResults = {};

		this.init = this._onInit.bind(this);
		this.pair = this._onPair.bind(this);
		this.added = this._onAdded.bind(this);
		this.deleted = this._onDeleted.bind(this);

		this.capabilities = {};

		this.capabilities.speaker_playing = {};
		this.capabilities.speaker_playing.get = this._onCapabilitySpeakerPlayingGet.bind(this);
		this.capabilities.speaker_playing.set = this._onCapabilitySpeakerPlayingSet.bind(this);

		this.capabilities.speaker_prev = {};
		this.capabilities.speaker_prev.set = this._onCapabilitySpeakerPrevSet.bind(this);

		this.capabilities.speaker_next = {};
		this.capabilities.speaker_next.set = this._onCapabilitySpeakerNextSet.bind(this);

		this.capabilities.volume_set = {};
		this.capabilities.volume_set.get = this._onCapabilityVolumeSetGet.bind(this);
		this.capabilities.volume_set.set = this._onCapabilityVolumeSetSet.bind(this);

		this._search();

	}

	log() {
		console.log.bind( null, '[log]' ).apply( null, arguments );
	}

	error() {
		console.log.bind( null, '[err]' ).apply( null, arguments );
	}

	_onInit( devices_data, callback ) {

		devices_data.forEach( this._initDevice.bind(this) );

		callback();
	}

	_search() {
		sonos.search((device) => {
			device.deviceDescription(( err, info ) => {
				if( err ) return this.error( err );

				this.log(`Found device ${info.roomName} (${info.modelName})`);
				this._searchResults[ info.serialNum ] = Object.assign({}, info, device);

				this.emit(`found:${info.serialNum}`);
			});
		});
	}

	_initDevice( device_data ) {
		this.log('_initDevice', device_data);

		let searchResult = this._searchResults[ device_data.sn ];
		if( searchResult ) {

			this._devices[ device_data.sn ] = {
				sonos: new sonos.Sonos( searchResult.host, searchResult.port ),
				state: {

				}
			}

		} else {
			this.on(`found:${device_data.sn}`, () => {
				this._initDevice( device_data );
			})
		}
	}

	_uninitDevice( device_data ) {
		this.log('_uninitDevice', device_data);

	}

	_getDevice( device_data ) {
		return this._devices[ device_data.sn ] || new Error('invalid_device');
	}

	_onPair( socket ) {

		socket
			.on('list_devices', ( data, callback ) => {

				let devices = [];

				for( let sn in this._searchResults ) {
					let searchResult = this._searchResults[ sn ];

					let deviceObj = {
						name: searchResult.roomName,
						data: {
							sn: searchResult.serialNum
						}
					};

					if( icons.indexOf( searchResult.modelNumber ) > -1 ) {
						deviceObj.icon = `/models/${searchResult.modelNumber}.svg`;
					}

					devices.push( deviceObj );
				}

				callback( null, devices );

			})

	}

	_onAdded( device_data ) {
		this.log('_onAdded', device_data);
		this._initDevice( device_data );
	}

	_onDeleted( device_data ) {
		this.log('_onDeleted', device_data);
		this._uninitDevice( device_data );
	}

	_onCapabilitySpeakerPlayingGet( device_data, callback ) {
		this.log('_onCapabilitySpeakerPlayingGet');

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		device.sonos.getCurrentState(( err, state ) => {
			if( err ) return callback( err );
			callback( null, state === 'playing' );
		});

	}

	_onCapabilitySpeakerPlayingSet( device_data, value, callback ) {
		this.log('_onCapabilitySpeakerPlayingSet', value);

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		if( value === true ) {
			device.sonos.play(callback);
		} else {
			device.sonos.pause(callback);
		}

	}

	_onCapabilitySpeakerPrevSet( device_data, value, callback ) {
		this.log('_onCapabilitySpeakerPrevSet', value);

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		device.sonos.previous(callback);

	}

	_onCapabilitySpeakerNextSet( device_data, value, callback ) {
		this.log('_onCapabilitySpeakerNextSet', value);

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		device.sonos.next(callback);

	}

	_onCapabilityVolumeSetGet( device_data, callback ) {
		this.log('_onCapabilityVolumeSetGet');

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		device.sonos.getVolume(( err, volume ) => {
			if( err ) return callback( err );
			callback( null, volume/100 );
		});

	}

	_onCapabilityVolumeSetSet( device_data, value, callback ) {
		this.log('_onCapabilityVolumeSetSet');

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		device.sonos.setVolume( value * 100, ( err, volume ) => {
			if( err ) return callback( err );
			callback( null, value );
		});

	}

}

module.exports = new Driver();







