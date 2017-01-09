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

		this.capabilities.volume_mute = {};
		this.capabilities.volume_mute.get = this._onCapabilityVolumeMuteGet.bind(this);
		this.capabilities.volume_mute.set = this._onCapabilityVolumeMuteSet.bind(this);

		Homey.manager('flow')
			.on('action.play', this._onFlowActionPlay.bind(this))
			.on('action.pause', this._onFlowActionPause.bind(this))
			.on('action.prev', this._onFlowActionPrev.bind(this))
			.on('action.next', this._onFlowActionNext.bind(this))
			.on('action.volume_set', this._onFlowActionVolumeSet.bind(this))
			.on('action.volume_mute', this._onFlowActionVolumeMute.bind(this))
			.on('action.volume_unmute', this._onFlowActionVolumeUnmute.bind(this));

		this._search();

	}

	/*
		Helper methods
	*/

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
					speaker_playing: false
				}
			}

			for( let capabilityId in this._devices[ device_data.sn ].state ) {
				module.exports.realtime( device_data, capabilityId, this._devices[ device_data.sn ].state[ capabilityId] );
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

	/*
		Exports
	*/

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

	/*
		Capabilities
	*/
	_onCapabilitySpeakerPlayingGet( device_data, callback ) {
		this.log('_onCapabilitySpeakerPlayingGet');

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		callback( null, device.state.speaker_playing );

	}

	_onCapabilitySpeakerPlayingSet( device_data, value, callback ) {
		this.log('_onCapabilitySpeakerPlayingSet', value);

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		if( value === true ) {
			device.sonos.play(( err ) => {
				if( err ) return callback( err );
				module.exports.realtime( device_data, 'speaker_playing', value );
				return callback( null, value );
			});
		} else {
			device.sonos.pause(( err ) => {
				if( err ) return callback( err );
				module.exports.realtime(device_data, 'speaker_playing', value );
				return callback( null, value );
			});
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
			return callback( null, volume/100 );
		});

	}

	_onCapabilityVolumeSetSet( device_data, value, callback ) {
		this.log('_onCapabilityVolumeSetSet', value);

		let device = this._getDevice( device_data );
		if( device instanceof Error ) return callback( device );

		device.sonos.setVolume( value * 100, ( err, volume ) => {
			if( err ) return callback( err );

			module.exports.realtime( device_data, 'volume_set', value );
			return callback( null, value );
		});

	}

  _onCapabilityVolumeMuteGet( device_data, callback ) {
    this.log('_onCapabilityVolumeMuteGet');

    let device = this._getDevice( device_data );
    if( device instanceof Error ) return callback( device );

    device.sonos.getMuted(( err, muted ) => {
      if( err ) return callback( err );
      return callback( null, muted );
    });

  }

  _onCapabilityVolumeMuteSet( device_data, value, callback ) {
    this.log('_onCapabilityVolumeMuteSet', value);

    let device = this._getDevice( device_data );
    if( device instanceof Error ) return callback( device );

    device.sonos.setMuted( value, ( err, muted ) => {
      if( err ) return callback( err );

      module.exports.realtime( device_data, 'volume_mute', value );
      return callback( null, value );
    });

  }
	/*
		Flow
	*/
	_onFlowActionPlay( callback, args ) {
		this._onCapabilitySpeakerPlayingSet( args.device, true, callback );
	}

	_onFlowActionPause( callback, args ) {
		this._onCapabilitySpeakerPlayingSet( args.device, false, callback );
	}

	_onFlowActionPrev( callback, args ) {
		this._onCapabilitySpeakerPrevSet( args.device, true, callback );
	}

	_onFlowActionNext( callback, args ) {
		this._onCapabilitySpeakerNextSet( args.device, true, callback );
	}

	_onFlowActionVolumeSet( callback, args ) {
		this._onCapabilityVolumeSetSet( args.device, args.volume, callback );
	}

  _onFlowActionVolumeMute( callback, args ) {
    this.log('_onFlowActionVolumeMute',args);
    this._onCapabilityVolumeMuteSet( args.device, true, callback );
  }

  _onFlowActionVolumeUnmute( callback, args ) {
    this.log('_onFlowActionVolumeUnmute',args);
    this._onCapabilityVolumeMuteSet( args.device, false, callback );
  }
}

module.exports = new Driver();







