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

/**
 * Encodes characters not allowed within html/xml tags
 * @param  {String} str
 * @return {String}
 */
const htmlEntities = function (str) {
	return String(str)
		.replace(/&(?!#?[a-z0-9]+;)/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
};

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
		console.log.bind(null, '[log]').apply(null, arguments);
	}

	error() {
		console.log.bind(null, '[err]').apply(null, arguments);
	}

	_onInit(devicesData, callback) {

		devicesData.forEach(this._initDevice.bind(this));

		callback();
	}

	_search() {
		sonos.search((device) => {
			device.deviceDescription((err, info) => {
				if (err) return this.error(err);

				this.log(`Found device ${info.roomName} (${info.modelName})`);
				this._searchResults[info.serialNum] = Object.assign({}, info, device);

				this.emit(`found:${info.serialNum}`);
			});
		});
	}

	_initDevice(deviceData) {
		this.log('_initDevice', deviceData);

		const searchResult = this._searchResults[deviceData.sn];
		if (searchResult) {
			console.log('found sonos', searchResult);

			if (this._devices[deviceData.sn] && this._devices[deviceData.sn].pollInterval) {
				clearInterval(this._devices[deviceData.sn].pollInterval);
			}

			const device = {
				sonos: new sonos.Sonos(searchResult.host, searchResult.port),
				state: {
					speaker_playing: false,
				},
				deviceData,
			};
			this._devices[deviceData.sn] = device;


			setTimeout(() => this.realtime(deviceData, 'speaker_playing', false), 1000);
			setTimeout(() => this.realtime(deviceData, 'speaker_playing', true), 2000);
			setTimeout(() => this.realtime(deviceData, 'speaker_playing', true), 3000);
			setTimeout(() => this.realtime(deviceData, 'speaker_playing', true), 4000);


			const pollState = () => {
				[
					{ fn: this._compareTrack.bind(this, device) },
					{ id: 'volume_set', fn: device.sonos.getVolume.bind(device.sonos), parse: vol => vol / 100 },
					{ id: 'volume_mute', fn: device.sonos.getMuted.bind(device.sonos) },
					// { id: 'get_queue' },
				].forEach(capability =>
					capability.fn((err, state) => {
						if (err) return Homey.error(err);

						state = capability.parse ? capability.parse(state) : state;

						if (capability.id) {
							device.state[capability.id] = state;
							this.realtime(deviceData, capability.id, state);
						}
						if (capability.onResult) {
							capability.onResult(err, state);
						}
					})
				);
			};

			device.pollInterval = setInterval(pollState, 5000);

			// device.sonos.play({ uri: 'spotify:track:7BKLCZ1jbUBVqRi2FVlTVw' }, console.log.bind(null, 'PLAY'));
			// this._playUrl(device, {
			// 	// stream_url: 'https://api.soundcloud.com/tracks/92285620/stream?client_id=c39d675784ad098e33ae68ca8057154c',
			// 	stream_url: 'https://chromecast.athomdev.com/song.mp3?client_id=c39d675784ad098e33ae68ca8057154c&amp;test=true',
			// 	// stream_url: 'http://translate.google.com/translate_tts?ie=UTF-8&total=1&idx=0&textlen=32&client=tw-ob&q=Hi%20this%20is%20a%20test&tl=En-gb',
			// 	// stream_url: 'https://cf-media.sndcdn.com/FLlfJVV2cQJn.128.mp3?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiKjovL2NmLW1lZGlhLnNuZGNkbi5jb20vRkxsZkpWVjJjUUpuLjEyOC5tcDMiLCJDb25kaXRpb24iOnsiRGF0ZUxlc3NUaGFuIjp7IkFXUzpFcG9jaFRpbWUiOjE0ODUxNzk0ODB9fX1dfQ__&Signature=CG4u-7lNQBopRdlgP6-giJbbw4KXH7FXYQtwuB6hU~fcshUmzxFL7O7yVcPY-4W6VzujkIV~EIzkpXFX8RaWkJ0j2NqO7XGaKyWVfSxqz70E8YGvuomwaY9oHdh5Rahm0FOuKPaGEfvqJx5WD7wauWcrEb6VNVKJgkoTp6jAYOukIw5MtB5Mob5NHwuydBefocryt4z3tcbYOybp40BZyV9gUcbEqyLkNHrY8PnBbaAJ26C4UDwI8PoWUU5kua8OW-mJhY4bmHcfw0qkjK89GmUVC-z8AVEiPCVRxl6avmVXcRnmPjRYkJQmNM0h0JwRF7Yx6UrcrOyZ6Bf1Aal1WA__&Key-Pair-Id=APKAJAGZ7VMH2PFPW6UQ',
			// 	// stream_url: 'https://r2---sn-5hne6nlr.c.doc-0-0-sj.sj.googleusercontent.com/videoplayback?id=ee712c3184908c23&itag=25&source=skyjam&begin=0&upn=5CIuIIfpFnQ&o=06776416745300621078&cmbypass=yes&ratebypass=yes&ip=217.114.108.248&ipbits=0&expire=1485188656&sparams=cmbypass,expire,id,ip,ipbits,itag,mm,mn,ms,mv,nh,o,pl,ratebypass,source,upn&signature=58AD2D61EB006E366961E276BF0CB80ACC14AB32.5661448B95FC48BCFFBF1EBCF542589042B2E4E3&key=cms1&mm=31&mn=sn-5hne6nlr&ms=au&mt=1485188449&mv=m&nh=IgpwcjA0LmFtczE1KgkxMjcuMC4wLjE&pl=20',
			// 	title: 'TIROL',
			// 	duration: 78000,
			// 	artwork: {
			// 		medium: 'https://pbs.twimg.com/profile_images/608222870708224001/WRlSqpdh.jpg',
			// 	},
			// }, console.log.bind(null, 'PLAY'));
			// // this._playSpotify(device, '7BKLCZ1jbUBVqRi2FVlTVw', console.log.bind(null, 'QUEUE'));

			// this._playSoundCloud(device, null, console.log.bind('PLAYSOUNDCLOUD'));


			this.registerSpeaker(deviceData, {
				codecs: ['spotify:track:id', 'homey:codec:mp3'],
			}, (err, speaker) => {
				if (err) return Homey.error(err);
				device.speaker = speaker;
				speaker.on('setTrack', this._setTrack.bind(this, device));
				speaker.on('setPosition', (position, callback) => {
					device.sonos.seek(Math.round(position / 1000), callback);
				});
				speaker.on('setActive', (isActive, callback) => {
					device.isActiveSpeaker = isActive;
					return callback();
				});
			});

			// device.sonos.getMusicLibrary('sonos_playlists', {}, console.log.bind(null, 'library'));

			device.sonos.searchMusicLibrary('sonos_playlists', '0:', {}, console.log.bind(null, 'tracks'));

		} else {
			this.on(`found:${deviceData.sn}`, () => {
				this._initDevice(deviceData);
			});
		}
	}

	_setTrack(device, data, cb) {
		const track = data.track;
		const callback = (err, result) => {
			device.trackQueued = false;
			cb(err, result);
		};
		device.trackQueued = Boolean(data.opts.delay);
		device.lastTrack = undefined;
		console.log('set track', track);
		const play = () => {
			this.realtime(device.deviceData, 'speaker_playing', false);
			switch (track.format) {
				case 'spotify:track:id':
					this._playSpotify(device, track.stream_url, data.opts, () => {
						device.sonos.currentTrack((err, currentTrack) => {
							console.log('got spotify track info', err, currentTrack);
							if (err) return callback(err);
							device.lastTrack = currentTrack;
							this.realtime(device.deviceData, 'speaker_playing', data.opts.startPlaying);
							device.speaker.updateState({ position: (currentTrack || {}).position * 1000, track: currentTrack });
							callback(null, true);
						});
					});
					break;
				default:
					this._playUrl(device, track, data.opts, () => {
						device.sonos.currentTrack((err, currentTrack) => {
							console.log('got track info', err, currentTrack);
							if (err) return callback(err);
							device.lastTrack = currentTrack;
							this.realtime(device.deviceData, 'speaker_playing', data.opts.startPlaying);
							device.speaker.updateState({ position: (currentTrack || {}).position * 1000, track: currentTrack });
							callback(null, true);
						});
					});
			}
		};
		if (device.nextTrackCallback) {
			device.nextTrackCallback(new Error('setTrack debounced'));
			device.nextTrackCallback = null;
			clearTimeout(device.nextTrackTimeout);
		}
		if (data.opts.delay) {
			device.nextTrackCallback = callback;
			device.nextTrackTimeout = setTimeout(() => {
				device.nextTrackCallback = null;
				play();
			}, data.opts.delay);
		} else {
			play();
		}
	}

	_playUrl(device, track, opts, callback) {
		const albumArt = track.artwork ? track.artwork.medium || track.artwork.large || track.artwork.small : null;
		const duration = track.duration ? `${Math.floor(track.duration / 3600000)
			}:${`0${Math.floor((track.duration % 3600000) / 60000)}`.slice(-2)
			}:${`0${Math.round((track.duration % 60000) / 1000)}`.slice(-2)}` : null;
		const uri = {
			uri: htmlEntities(track.stream_url),
			metadata: '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
			'xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ' +
			'xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dlna="urn:schemas-dlna-org:metadata-1-0/">' +
			'<item id="R:0/0/0" restricted="1">' +
			(duration ? `<res duration="${duration}"></res>` : '') +
			`<dc:title>${track.title || track.stream_url}</dc:title>` +
			`<upnp:artist role="Performer">${
			((track.artist || []).find(artist => artist.type === 'artist') || {}).name || ''}</upnp:artist>` +
			`<upnp:album>${track.album || ''}</upnp:album>` +
			`<dc:date>${track.release_date || '' /* TODO */}</dc:date>` +
			`<upnp:genre>${track.genre || ''}</upnp:genre>` +
			(albumArt ? `<upnp:albumArtURI>${albumArt}</upnp:albumArtURI>` : '') +
			'<upnp:class>object.item.audioItem.musicTrack</upnp:class>' +
			'</item>' +
			'</DIDL-Lite>',
		};

		// if (delay) {
		// 	device.sonos.queue(uri, (err, result) => {
		// 		console.log('queueNext', err, result);
		// 		callback(err, result);
		// 	});
		// } else {
		device.sonos.flush(err => {
			if (err) return console.log('flush err') & callback(err);
			device.sonos.selectQueue(err => {
				if (err) return console.log('selectQueue err') & callback(err);

				if (opts.startPlaying) {
					device.sonos.play(uri, (err, result) => {
						console.log('play', err, result);
						callback(err, result);
					});
				} else {
					device.sonos.queue(uri, (err, queueResult) => {
						if (err || !queueResult || queueResult.length < 0 || !queueResult[0].FirstTrackNumberEnqueued) {
							return callback(err);
						}
						const selectTrackNum = queueResult[0].FirstTrackNumberEnqueued[0];
						device.sonos.selectTrack(selectTrackNum, callback);
					});
				}
			});
		});
		// }
	}

	_playSpotify(device, trackId, opts, callback) {
		// if (opts.delay) {
		// 	device.sonos.addSpotifyQueue(trackId, (err, result) => {
		// 		console.log('addSpotifyQueue 2', err, result);
		// 		callback(err, result);
		// 	});
		// } else {
		device.sonos.selectQueue(err => {
			if (err) return console.log('selectQueue err') & callback(err);
			device.sonos.flush(err => {
				if (err) return callback(err);
				device.sonos.addSpotifyQueue(trackId, (err, result) => {
					console.log('addSpotifyQueue', err, result);
					if (err) return callback(err);
					if (opts.startPlaying) {
						device.sonos.play(callback);
					} else {
						callback(null, true);
					}
				});
			});
		});
		// }
	}

	_playSoundCloud(device, trackId, callback) {
		device.sonos.flush(err => {
			if (err) return callback(err);
			device.sonos.play({ uri: 'x-sonos-http:track%3a232202756.mp3?sid=160&flags=8224&sn=10' }, (err, result) => {
				callback(err, result);
				device.sonos.currentTrack(console.log.bind(null, 'TRACK'));
			});
		});
	}

	_compareTrack(device, callback) {
		device.sonos.currentTrack((err, track) => {
			if (err) return callback(err);
			if (device.isActiveSpeaker && device.lastTrack) {
				const diffProp = Object.keys(track).find((trackProp) =>
					trackProp !== 'position' && device.lastTrack[trackProp] !== track[trackProp]
				);
				if (diffProp) {
					console.log('Property', diffProp, 'is not equal to lastTrack');
					if (device.lastTrack.strikes > 2) {
						console.log('your out');
						return device.speaker.updateState(new Error('Track not in sync with Homey'));
					}
					console.log('strike');
					device.lastTrack.strikes = (device.lastTrack.strikes || 0) + 1;
					return;
				}
				device.lastTrack.strikes = 0;
				if (!(track.position === 0 && track.duration - device.lastPos <= 10)) {
					console.log('correct, updating position', track.position * 1000);
					device.speaker.updateState({ position: track.position * 1000 });
					device.sonos.getCurrentState((err, state) => {
						if (err) return callback(err);
						this.realtime(device.deviceData, 'speaker_playing', state === 'playing');
						callback();
					});
				} else {
					callback();
				}
			}
		});
	}

	_uninitDevice(deviceData) {
		clearInterval(this._devices[deviceData.sn].pollInterval);
		this.log('_uninitDevice', deviceData);
	}

	_getDevice(deviceData) {
		return this._devices[deviceData.sn] || new Error('invalid_device');
	}

	/*
	 Exports
	 */

	_onPair(socket) {

		socket
			.on('list_devices', (data, callback) => {

				const devices = [];

				for (const sn in this._searchResults) {
					const searchResult = this._searchResults[sn];

					const deviceObj = {
						name: searchResult.roomName,
						data: {
							sn: searchResult.serialNum,
						},
					};

					if (icons.indexOf(searchResult.modelNumber) > -1) {
						deviceObj.icon =
							`/models/${searchResult.modelNumber}.svg`
						;
					}

					devices.push(deviceObj);
				}

				callback(null, devices);

			});

	}

	_onAdded(deviceData) {
		this.log('_onAdded', deviceData);
		this._initDevice(deviceData);
	}

	_onDeleted(deviceData) {
		this.log('_onDeleted', deviceData);
		this._uninitDevice(deviceData);
	}

	/*
	 Capabilities
	 */
	_onCapabilitySpeakerPlayingGet(deviceData, callback) {
		this.log('_onCapabilitySpeakerPlayingGet');

		const device = this._getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		callback(null, device.state.speaker_playing);

	}

	_onCapabilitySpeakerPlayingSet(deviceData, value, callback) {
		this.log('_onCapabilitySpeakerPlayingSet', value);

		const device = this._getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		if (value === true) {
			device.sonos.play((err) => {
				if (err) return callback(err);
				this.realtime(deviceData, 'speaker_playing', value);
				return callback(null, value);
			});
		} else {
			if (device.nextTrackCallback) {
				device.nextTrackCallback(new Error('setTrack debounced'));
				device.nextTrackCallback = null;
				clearTimeout(device.nextTrackTimeout);
			}
			device.sonos.pause((err) => {
				if (err) return callback(err);
				this.realtime(deviceData, 'speaker_playing', value);
				return callback(null, value);
			});
		}

	}

	_onCapabilitySpeakerPrevSet(deviceData, value, callback) {
		this.log('_onCapabilitySpeakerPrevSet', value);

		const device = this._getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.sonos.previous(callback);

	}

	_onCapabilitySpeakerNextSet(deviceData, value, callback) {
		this.log('_onCapabilitySpeakerNextSet', value);

		const device = this._getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.sonos.next(callback);

	}

	_onCapabilityVolumeSetGet(deviceData, callback) {
		this.log('_onCapabilityVolumeSetGet');

		const device = this._getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.sonos.getVolume((err, volume) => {
			if (err) return callback(err);
			return callback(null, volume / 100);
		});

	}

	_onCapabilityVolumeSetSet(deviceData, value, callback) {
		this.log('_onCapabilityVolumeSetSet', value);

		const device = this._getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.sonos.setVolume(value * 100, (err) => {
			if (err) return callback(err);

			this.realtime(deviceData, 'volume_set', value);
			return callback(null, value);
		});

	}

	_onCapabilityVolumeMuteGet(deviceData, callback) {
		this.log('_onCapabilityVolumeMuteGet');

		const device = this._getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.sonos.getMuted((err, muted) => {
			if (err) return callback(err);
			return callback(null, muted);
		});

	}

	_onCapabilityVolumeMuteSet(deviceData, value, callback) {
		this.log('_onCapabilityVolumeMuteSet', value);

		const device = this._getDevice(deviceData);
		if (device instanceof Error) return callback(device);

		device.sonos.setMuted(value, (err) => {
			if (err) return callback(err);

			this.realtime(deviceData, 'volume_mute', value);
			return callback(null, value);
		});

	}

	/*
	 Flow
	 */
	_onFlowActionPlay(callback, args) {
		this._onCapabilitySpeakerPlayingSet(args.device, true, callback);
	}

	_onFlowActionPause(callback, args) {
		this._onCapabilitySpeakerPlayingSet(args.device, false, callback);
	}

	_onFlowActionPrev(callback, args) {
		this._onCapabilitySpeakerPrevSet(args.device, true, callback);
	}

	_onFlowActionNext(callback, args) {
		this._onCapabilitySpeakerNextSet(args.device, true, callback);
	}

	_onFlowActionVolumeSet(callback, args) {
		this._onCapabilityVolumeSetSet(args.device, args.volume, callback);
	}

	_onFlowActionVolumeMute(callback, args) {
		this.log('_onFlowActionVolumeMute', args);
		this._onCapabilityVolumeMuteSet(args.device, true, callback);
	}

	_onFlowActionVolumeUnmute(callback, args) {
		this.log('_onFlowActionVolumeUnmute', args);
		this._onCapabilityVolumeMuteSet(args.device, false, callback);
	}
}

module.exports = new Driver();
