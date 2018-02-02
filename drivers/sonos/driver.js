'use strict';

const Homey = require('homey');

const ICONS = [
	'S1', // Play:1
	'S13', // Play One
	'S3', // Play:3
	'S5', // Play:5
	'S9', // Playbar
	'ZP100',
	'ZP120', // Connect:Amp
	'ZP90', // Connect
	//	'SUB'
];
const PLAYLIST_REFRESH_TIMEOUT = 60 * 60 * 1000;
const urlParser = /^http:\/\/([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}):([0-9]{1,5})/i;

module.exports = class SonosDriver extends Homey.Driver {

	onInit() {
		this.api = Homey.app.getApi();

		this.listDevicesTimeout = 20000;

		new Homey.FlowCardCondition('playback_state')
			.register()
			.registerRunListener(this._onFlowConditionPlaybackState.bind(this));
		new Homey.FlowCardAction('group_volume_mute')
			.register()
			.registerRunListener(this._onFlowActionVolumeMute.bind(this));
		new Homey.FlowCardAction('group_volume_unmute')
			.register()
			.registerRunListener(this._onFlowActionVolumeUnmute.bind(this));
		new Homey.FlowCardAction('not_group_volume_set')
			.register()
			.registerRunListener(this._onFlowActionVolume.bind(this));
	}

	getPlayers() {
		return this.api.getPlayers();
	}

	onPair(socket) {

		socket
			.on('list_devices', async (data, callback) => {

				Homey.app.restartApi();
				let topologyChangeCallback;
				await Promise.race([
					new Promise(resolve => {
						topologyChangeCallback = resolve;
						this.api.once('topology-change', resolve);
					}),
					new Promise(resolve => setTimeout(resolve, this.listDevicesTimeout))
				]).then(() => {
					this.api.removeListener('topology-change', topologyChangeCallback);
				});

				const devices = (await Promise.all(
					this.api.getPlayers()
						.filter(player =>
							!this.getDevices().some(device => device.getData().sn === player.uuid)
						)
						.map(player => {
							return this.api.actions.info(player)
								.then(info => {
									console.log('INFO', info);
									const deviceData = {
										name: player.roomName,
										data: {
											sn: player.uuid,
										}
									};

									if (ICONS.indexOf(info.modelNumber[0]) !== -1) {
										deviceData.icon =
											`/models/${info.modelNumber[0]}.svg`
										;
									}

									return deviceData;
								});
						})
				));

				callback(null, devices);

			});

	}

	_onFlowConditionPlaybackState(args) {
		return args.device.instance && args.device.instance.state.playbackState && args.state === args.device.instance.state.playbackState.toLowerCase();
	}

	_onFlowActionVolumeMute(args) {
		return args.device.muteVolume(true);
	}

	_onFlowActionVolumeUnmute(args) {
		return args.device.muteVolume(false);
	}

	_onFlowActionVolume(args) {
		return args.device.setVolume(args.volume);
	}
};
