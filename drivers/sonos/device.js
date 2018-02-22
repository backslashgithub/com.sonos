'use strict';

const Homey = require('homey');
const logger = require('homey-log').Log;

const MAX_RECONNECT_TIMEOUT = 60 * 60 * 1000;

module.exports = class SonosDevice extends Homey.Device {

	onInit() {
		this.api = Homey.app.getApi();

		// Store the uuid value in this.uuid for backwards compatibility
		this.uuid = this.getData().uuid || this.getData().sn;

		// Incrementing ID to detect if a track is requested before the previous track started playing.
		this.trackRequestId = 0;
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
		const player = this.api.getPlayer(this.uuid);

		if (player instanceof Error) {
			logger.setExtra({ [this.uuid]: player });
			return this.onDead();
		}
		if (this.instance) return this._updateInstanceState(); // TODO check how to handle disconnect -> reconnect

		logger.setExtra({ [this.uuid]: player });
		this.instance = player;

		this.emit('instance');
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

			this.speaker.on('setActive', (isActive, callback) => {
				const res = this._setActive(isActive);
				if (res instanceof Error) return callback(res);

				callback(null, res);
			});
			this.speaker.on('setTrack', (track, callback) =>
				this._setTrack(track)
					.then(res => callback(null, res))
					.catch(err => callback(err || new Error()))
			);
			this.speaker.on('setPosition', (position, callback) =>
				this.seek(position)
					.then(res => callback(null, res))
					.catch(err => callback(err || new Error()))
			);
		}
		return this.speaker.register({
			codecs: [Homey.app.SONOS_CODEC, 'spotify:track:id', Homey.Codec.MP3],
		});
	}

	_registerListeners() {
		if (!this.instance) throw new Error('error.no_instance');
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
		if (this.speaker && this.speaker.active) this.speaker.setInactive(Homey.__('error.lost_connection'));

		this._unregisterListeners();
		this.instance = null;
		this.setUnavailable(Homey.__('error.device_not_found'));

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
		this.getCapabilities().forEach(capability =>
			this.registerCapabilityListener(capability, (value) => {
				return capabilitySetMap.get(capability).call(this, value)
					.catch(err => {
						return Promise.reject(err)
					});
			})
		);
	}

	_setActive(isActive) {
		this.isActive = isActive;
		if (isActive) {
			if (!this.instance) return new Error(Homey.__('error.no_instance'));
		}
		this.instance.actions.clearqueue();
	}

	async _setTrack({ track, opts: { position, delay = 0, startPlaying } = {} } = {}) {
		if (!this.instance) return Promise.reject(new Error(Homey.__('error.no_instance')));
		const funcStart = Date.now();
		const trackRequestId = ++this.trackRequestId;

		const resolve = async () => {
			if (this.trackRequestId !== trackRequestId) {
				return Promise.reject('debounced');
			}

			this.blockSpeakerStateUpdate = false;

			this.nextTrack = null;
			this.currentTrack = track;
			if (position) {
				await this.seek(position)
					.catch(() => null);
			}

			let emitPositionTimeout;
			const onTransportState = () => clearTimeout(emitPositionTimeout);
			emitPositionTimeout = setTimeout(() => {
				this.instance.coordinator.removeListener('transport-state', onTransportState);
				this.speaker.updateState({ position: this.instance.state.elapsedTime * 1000 });
			}, 3000);
			this.instance.coordinator.once('transport-state', onTransportState);

			await (startPlaying ? this.instance.actions.play() : this.instance.actions.pause())
				.catch(() => null);
		};

		const resolveSetUri = () => {
			this.log('Playing track', track.stream_url);

			if (now) {
				return resolve();
			} else {
				if (this.currentTrack && this.nextTrack.stream_url === this.currentTrack.stream_url) {
					if (this.instance.state.elapsedTime < 10000) {
						return resolve();
					}
				} else if (decodeURIComponent(this.instance.state.currentTrack.uri).includes(this.nextTrack.stream_url)) {
					return resolve();
				}
				return new Promise((res) => {
					let onNextTrackTimeout;
					const onTransportState = () => {
						if (
							this.instance.state.elapsedTime < 10000 &&
							this.instance.state.currentTrack &&
							decodeURIComponent(this.instance.state.currentTrack.uri).includes(this.nextTrack.stream_url)
						) {
							clearTimeout(onNextTrackTimeout);
							this.instance.coordinator.removeListener('transport-state', onTransportState);
							return res(resolve());
						}
					};
					onNextTrackTimeout = setTimeout(() => {
						this.instance.coordinator.removeListener('transport-state', onTransportState);
						if (
							(
								this.instance.state.currentTrack &&
								decodeURIComponent(this.instance.state.currentTrack.uri).includes(this.nextTrack.stream_url)
							) ||
							this.trackRequestId !== trackRequestId
						) {
							return res(resolve());
						} else {
							this.blockSpeakerStateUpdate = false;
							res(this._setTrack({ track, opts: { position, startPlaying } }));
						}
					}, delay + 5000);
					this.instance.coordinator.on('transport-state', onTransportState);
				});
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
						this.error('Error playing track', err);
						logger.captureException(err, { message: 'unable_to_play_spotify', extra: { device: this.uuid } });
						return Promise.reject(new Error(Homey.__('error.unable_to_play_spotify')));
					});
				break;
			case Homey.app.SONOS_CODEC:
				return this.instance.actions.setsonosuri(now ? 'now' : 'next', track)
					.then(resolveSetUri)
					.catch(err => {
						this.blockSpeakerStateUpdate = false;
						this.error('Error playing track', err);
						logger.captureException(err, { message: 'unable_to_play_sonos', extra: { device: this.uuid } });
						return Promise.reject(new Error(Homey.__('error.unable_to_play_sonos')));
					});
				break;
			case Homey.Codec.MP3:
				return this.instance.actions.stream(now ? 'now' : 'next', track)
					.then(resolveSetUri)
					.catch(err => {
						this.blockSpeakerStateUpdate = false;
						this.error('Error playing track', err);
						logger.captureException(err, { message: 'unable_to_play_track', extra: { device: this.uuid } });
						return Promise.reject(new Error(Homey.__('error.unable_to_play_track')));
					});
				break;
		}
	}

	handleActionError(msg, err) {
		const userError = new Error(msg);
		logger.captureException(err, { message: userError.message, extra: { device: this.uuid } });
		this.error(userError.message, err);
		return Promise.reject(err);
	}

	play(state) {
		if (!this.instance) return Promise.reject(new Error(Homey.__('error.no_instance')));

		return (state ? this.instance.actions.play() : this.instance.actions.pause())
			.catch(this.handleActionError.bind(this, `Could not ${state ? 'play' : 'pause'}`));
	}

	seek(position) {
		if (!this.instance) return Promise.reject(new Error(Homey.__('error.no_instance')));

		return this.instance.coordinator.actions.seek(Math.round(position / 1000))
			.catch(this.handleActionError.bind(this, `Could not seek to ${position}ms in track`));
	}

	prev() {
		if (!this.instance) return Promise.reject(new Error(Homey.__('error.no_instance')));

		return this.instance.actions.previous()
			.catch(this.handleActionError.bind(this, 'Could not go to previous track'));
	}

	next() {
		if (!this.instance) return Promise.reject(new Error(Homey.__('error.no_instance')));

		return this.instance.actions.next()
			.catch(this.handleActionError.bind(this, 'Could not go to next track'));
	}

	setGroupVolume(volume) {
		if (!this.instance) return Promise.reject(new Error(Homey.__('error.no_instance')));

		return this.instance.actions.groupvolume(volume * 100)
			.catch(this.handleActionError.bind(this, `Could not set group volume to ${volume}%`));
	}

	muteGroupVolume(mute) {
		if (!this.instance) return Promise.reject(new Error(Homey.__('error.no_instance')));

		return this.instance.actions[mute ? groupmute : groupunmute]()
			.catch(this.handleActionError.bind(this, `Could not ${mute ? '' : 'un'}mute group volume`));
	}

	setVolume(volume) {
		if (!this.instance) return Promise.reject(new Error(Homey.__('error.no_instance')));

		return this.instance.actions.volume(volume * 100)
			.catch(this.handleActionError.bind(this, `Could not set volume to ${volume}%`));
	}

	muteVolume(mute) {
		if (!this.instance) return Promise.reject(new Error(Homey.__('error.no_instance')));

		return (this.instance.actions[mute ? mute : unmute]())
			.catch(this.handleActionError.bind(this, `Could not ${mute ? '' : 'un'}mute volume`));
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
