'use strict';

const Homey = require('homey');

const MAX_RECONNECT_TIMEOUT = 60 * 60 * 1000;

module.exports = class SonosDevice extends Homey.Device {

	onInit() {
		this.api = Homey.app.getApi();

		this.pollTrackInterval = 5000;
		this.isActive = false;

		this.onDead = this._onDead.bind(this);
		this.getInstance = this._getInstance.bind(this);
		this.onTransportState = this._onTransportState.bind(this);
		this.onVolumeChange = this._onVolumeChange.bind(this);
		this.onMuteChange = this._onMuteChange.bind(this);

		this.api.on('topology-change', this.getInstance);
		this.on('instance', this.initInstance.bind(this));

		this._getInstance();

		this._registerCapabilities();
	}

	_getInstance() {
		const player = this.api.getPlayer(this.getData().sn);

		if (player instanceof Error) {
			return this.onDead();
		}
		if (this.instance) return this._updateInstanceState(); // TODO check how to handle disconnect -> reconnect

		this.instance = player;

		this.emit('instance');
		console.log(this.instance);
	}

	initInstance() {
		clearTimeout(this.reconnectTimeout);
		this.setAvailable();

		this._registerSpeaker();

		// this.setCapabilityValue('speaker_playing', this.instance)
		this._updateInstanceState();
		this._registerListeners();
	}

	_registerSpeaker() {
		if (!this.speaker) {
			this.speaker = new Homey.Speaker(this);

			this.speaker.on('setTrack', this._setTrack.bind(this));
			this.speaker.on('setPosition', this._setPosition.bind(this));
			this.speaker.on('setActive', this._setActive.bind(this));
		}
		return this.speaker.register({
			codecs: [Homey.app.SONOS_CODEC, 'spotify:track:id', Homey.Codec.MP3],
		});
	}

	_registerListeners() {
		if (!this.instance) throw new Error('no_instance');
		this.instance.on('dead', this.onDead);
		this.instance.coordinator.on('dead', this.onDead);
		this.instance.coordinator.on('transport-state', this.onTransportState);
		this.instance.coordinator.on('group-mute', this.onMuteChange);
		this.instance.coordinator.on('group-volume', this.onVolumeChange);
	}

	_unregisterListeners() {
		if (!this.instance) return;
		this.instance.removeListener('dead', this.onDead);
		this.instance.coordinator.removeListener('dead', this.onDead);
		this.instance.coordinator.removeListener('transport-state', this.onTransportState);
		this.instance.coordinator.removeListener('group-mute', this.onMuteChange);
		this.instance.coordinator.removeListener('group-volume', this.onVolumeChange);
	}

	_onDead() {
		if (this.speaker && this.speaker.active) this.speaker.setInactive(__('lost_connection'));

		this._unregisterListeners();
		this.instance = null;
		this.setUnavailable('device_not_found');

		const tryReconnect = (timeout) => {
			if (this.instance) return;
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = setTimeout(() => {
				Homey.app.restartApi();
				tryReconnect(Math.min(timeout * 1.5, MAX_RECONNECT_TIMEOUT));
			}, timeout);
		};
		tryReconnect(60 * 1000);
	}

	_updateInstanceState() {
		this.instance.actions.zones().then(result => console.log('ZONE RESULT', require('util').inspect(result, { depth: 10 })));
		this.setCapabilityValue('volume_set', this.instance.coordinator.groupState.volume / 100);
		this.setCapabilityValue('volume_mute', this.instance.coordinator.groupState.mute);
		this.setCapabilityValue('speaker_playing', this.instance.coordinator.state.playbackState === 'PLAYING');
	}

	_onTransportState() {
		if (this.blockSpeakerStateUpdate) return;
		this.setCapabilityValue('speaker_playing', this.instance.state.playbackState === 'PLAYING');
		if (this.speaker && this.speaker.isActive) {
			this.speaker.updateState({ position: this.instance.state.elapsedTime * 1000 });
		}
	}

	_onVolumeChange({ newVolume }) {
		this.setCapabilityValue('volume_set', newVolume / 100);
	}

	_onMuteChange({ newMute }) {
		console.log('mute_change', newMute);
		this.setCapabilityValue('volume_mute', newMute);
	}

	_registerCapabilities() {
		const capabilitySetMap = new Map([
			['speaker_playing', this.play],
			['speaker_prev', this.prev],
			['speaker_next', this.next],
			['volume_set', this.setGroupVolume],
			['volume_mute', this.muteGroupVolume],
		]);
		this.registerMultipleCapabilityListener(this.getCapabilities(), (valueObj, optsObj) => {
			if (!this.instance) return Promise.reject(new Error('No instance'));

			const actions = [];

			Object.keys(valueObj).forEach(capability => {
				if (capabilitySetMap.has(capability)) {
					actions.push(capabilitySetMap.get(capability).call(this, valueObj[capability]));
				}
			});

			return Promise.all(actions);
		}, 500);
	}

	_setActive(isActive, callback) {
		this.isActive = isActive;
		if (isActive) {
			if (!this.instance) return callback(new Error('No Connection'));
		}
		this.instance.actions.clearqueue();
		callback();
	}

	async _setTrack({ track, opts: { position, delay = 0, startPlaying } = {} } = {}, callback) {
		if (!this.instance) return callback(new Error('No Connection'));
		const funcStart = Date.now();
		console.log('SET TRACK', track.stream_url, track.codec, position, delay, startPlaying);

		const resolve = async () => {
			this.nextTrack = null;
			this.currentTrack = track;
			if (position) {
				await this.instance.coordinator.actions.timeseek(Math.round(position / 1000))
					.catch((err) => {
						console.log('ERROR TIMESEEK', err);
					});
			}

			let emitPositionTimeout;
			const onTransportState = () => clearTimeout(emitPositionTimeout);
			emitPositionTimeout = setTimeout(() => {
				console.log('UPDATE POSITION', this.instance.state.elapsedTime);
				this.instance.coordinator.removeListener('transport-state', onTransportState);
				this.speaker.updateState({ position: this.instance.state.elapsedTime * 1000 });
			}, 3000);
			this.instance.coordinator.once('transport-state', onTransportState);

			if (callback) {
				await this.instance.coordinator.actions[startPlaying ? 'play' : 'pause']()
					.catch((err) => {
						console.log('ERROR PLAYPAUSE', err);
					});
			}
			if (callback) {
				callback(null, true);
			}
			this.blockSpeakerStateUpdate = false;
		};

		// const startTimeout = () => {
		// 	return new Promise((resolve, reject) => {
		// 		// if so, set the callback on the device object
		// 		this.queuedCallback = (err) => {
		// 			// Clear the callback from the device object
		// 			this.queuedCallback = null;
		// 			// Clear the timeout that was intended to play the track on the speaker
		// 			clearTimeout(this.queuedTimeout);
		// 			reject(err);
		// 			callback(err);
		// 		};
		// 		// Set a timeout function which will play the track on the speaker when the timeout fires
		// 		this.queuedTimeout = setTimeout(() => {
		// 			// When the timeout is fired clear the corresponding variables from the device object
		// 			this.queuedCallback = null;
		// 			this.queuedTimeout = null;
		// 			// Call the function which will play the track
		// 			resolve(this._setTrack({ track, opts: { position, startPlaying } }, callback));
		// 		}, delay); // set the timeout for the given delay in the opts object
		// 	});
		// };

		// Check if the device has an queuedCallback option indicating that there already is a track queued
		if (this.queuedCallback) {
			// Call the callback with the track that is queued with an error to indicate that the corresponding track is cancelled
			this.queuedCallback(new Error('setTrack debounced'));
		}

		const resolveSetUri = (result) => {
			console.log('Playing track!', result);

			if (now) {
				resolve();
			} else {
				if (this.currentTrack && this.nextTrack.stream_url === this.currentTrack.stream_url) {
					if (this.instance.state.elapsedTime < 10000) {
						return resolve();
					}
				} else if (decodeURIComponent(this.instance.state.currentTrack.uri).includes(this.nextTrack.stream_url)) {
					return resolve();
				}
				let onNextTrackTimeout;
				const onTransportState = () => {
					if (
						this.instance.state.elapsedTime < 10000 &&
						this.instance.state.currentTrack &&
						decodeURIComponent(this.instance.state.currentTrack.uri).includes(this.nextTrack.stream_url)
					) {
						clearTimeout(onNextTrackTimeout);
						this.instance.coordinator.removeListener('transport-state', onTransportState);
						resolve();
					}
				};
				onNextTrackTimeout = setTimeout(() => {
					this.instance.coordinator.removeListener('transport-state', onTransportState);
					if (
						this.instance.state.currentTrack &&
						decodeURIComponent(this.instance.state.currentTrack.uri).includes(this.nextTrack.stream_url)
					) {
						resolve();
					} else {
						this.blockSpeakerStateUpdate = false;
						this._setTrack(track, { position, startPlaying }, callback);
					}
				}, delay + 5000);
				this.instance.coordinator.on('transport-state', onTransportState);
			}
		};

		this.blockSpeakerStateUpdate = true;
		this.nextTrack = track;
		const now = delay < 500;
		if (now) {
			if (delay - (Date.now() - funcStart) > 100) {
				await new Promise(resolve => setTimeout(resolve, delay - (Date.now() - funcStart)));
			}
			await this.instance.actions.clearqueue()
				.catch(() => null);
		}
		switch (track.codec) {
			case 'spotify:track:id':
				return this.instance.actions.spotify(now ? 'now' : 'next', `spotify:track:${track.stream_url}`)
					.then(resolveSetUri)
					.catch(err => {
						this.blockSpeakerStateUpdate = false;
						console.log('ERR playing track', err);
						callback(new Error('Unable to play spotify track. Make sure you have logged into your spotify account on your sonos system.'));
					});
				break;
			case Homey.app.SONOS_CODEC:
				const queueUriIndex = track.stream_url.indexOf('/');
				const queueUri = track.stream_url.slice(0, queueUriIndex);
				track.stream_url = track.stream_url.slice(queueUriIndex + 1);
				return this.instance.actions.setsonosuri(now ? 'now' : 'next', track.stream_url, queueUri)
					.then(resolveSetUri)
					.catch(err => {
						this.blockSpeakerStateUpdate = false;
						console.log('ERR playing track', err);
						callback(new Error('Unable to play Sonos track.'));
					});
				break;
			case Homey.Codec.MP3:
				return this.instance.actions.clearqueue()
					.catch(() => null)
					.then(() => this.instance.actions.stream(now ? 'now' : 'next', track))
					.then(resolve)
					.catch(err => {
						this.blockSpeakerStateUpdate = false;
						console.log('ERR playing track', err);
						callback(new Error('Unable to play track.'));
					});
				break;
		}
	}

	_setPosition(position, callback) {
		if (!this.instance) return callback(new Error('No Connection'));
		console.log('SET Position', position);
		this.instance.coordinator.actions.seek(Math.round(position / 1000))
			.then(() => callback(null, true))
			.catch(err => callback(new Error('Unable to seek track')));
	}

	play(state) {
		if (!this.instance) return Promise.reject(new Error('No instance'));

		return state ? this.instance.actions.play() : this.instance.actions.pause();
	}

	prev() {
		if (!this.instance) return Promise.reject(new Error('No instance'));

		return this.instance.actions.previous();
	}

	next() {
		if (!this.instance) return Promise.reject(new Error('No instance'));

		return this.instance.actions.next();
	}

	setGroupVolume(volume) {
		if (!this.instance) return Promise.reject(new Error('No instance'));

		return this.instance.actions.groupvolume(volume * 100);
	}

	muteGroupVolume(mute) {
		if (!this.instance) return Promise.reject(new Error('No instance'));

		return this.instance.actions[mute ? groupmute : groupunmute]();
	}

	setVolume(volume) {
		if (!this.instance) return Promise.reject(new Error('No instance'));

		return this.instance.actions.volume(volume * 100);
	}

	muteVolume(mute) {
		if (!this.instance) return Promise.reject(new Error('No instance'));

		return this.instance.actions[mute ? mute : unmute]();
	}

	onDeleted() {
		this.api.removeListener('topology-change', this.getInstance);
		this.clearPollInterval();
	}

	clearPollInterval() {
		if (this.pollInterval) {
			clearInterval(this.pollInterval);
			this.pollInterval = null;
		}
	}

};
