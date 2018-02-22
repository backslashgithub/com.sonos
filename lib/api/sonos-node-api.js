'use strict';
const events = require('events');

const fs = require('fs');
const path = require('path');

class NodeAPI extends events.EventEmitter {

	constructor(discovery, settings) {
		super();

		this.UUIDMap = new Map();
		this.actions = {};
		this.actionBlacklist = ['clip.js', 'clipall.js', 'clippreset.js', 'say.js', 'sayall.js', 'saypreset.js'];

		this.getWebRoot = () => settings.webroot;

		this.getPort = () => settings.port;

		const logEvents = false;
		this.onTransportState = (player) => this.emit('transport-state', player) | (logEvents && console.log('transport-state', player));
		this.onTopologyChange = (topology) => this.emit('topology-change', topology) | (logEvents && console.log('topology-change', topology));
		this.onVolumeChange = (volumeChange) => this.emit('volume-change', volumeChange) | (logEvents && console.log('volume-change', volumeChange));
		this.onMuteChange = (muteChange) => this.emit('mute-change', muteChange) | (logEvents && console.log('mute-change', muteChange));
		this.setDiscovery(discovery);

		// load modularized actions
		this.requireDir(path.join(__dirname, '../../node_modules/sonos-http-api/lib/actions'), (registerAction) => {
			registerAction(this);
		});
		this.requireDir(path.join(__dirname, '/actions'), (registerAction) => {
			registerAction(this);
		});
	}

	setDiscovery(discovery) {
		if (this.discovery) {
			this.discovery.removeListener('transport-state', this.onTransportState);
			this.discovery.removeListener('topology-change', this.onTopologyChange);
			this.discovery.removeListener('volume-change', this.onVolumeChange);
			this.discovery.removeListener('mute-change', this.onMuteChange);
		}
		discovery.on('transport-state', this.onTransportState);
		discovery.on('topology-change', this.onTopologyChange);
		discovery.on('volume-change', this.onVolumeChange);
		discovery.on('mute-change', this.onMuteChange);
		this.discovery = discovery;
	}

	// this handles registering of all actions
	registerAction(action, handler) {
		this.actions[action] = handler;
	}

	getPlayers() {
		return this.discovery.players;
	}

	getPlayerByUUID(uuid) {
		if (!uuid.startsWith('RINCON_')) {
			if (!this.UUIDMap.has(uuid)) {
				const macAddress = uuid.match(/((^|-)[0-9A-F]{2}){6}/i);
				if (macAddress) {
					const uuidMatch = macAddress[0].replace(/-/g, '').toUpperCase();
					const result = this.discovery.players.find((player) => player.uuid.includes(uuidMatch));
					if (result) {
						this.UUIDMap.set(uuid, result.uuid);
					}
					return result;
				}
				return;
			}
			uuid = this.UUIDMap.get(uuid);
		}
		return this.discovery.players.find((player) => player.uuid === uuid);
	}

	getPlayer(uuid) {
		const player = uuid ? this.getPlayerByUUID(uuid) : this.discovery.getAnyPlayer();

		if (!player) return new Error(uuid ? `Player ${uuid} not found` : 'No player found');

		player.actions = {};
		return Object.keys(this.actions).reduce((playerObj, action) => {
			playerObj.actions[action] = (...args) => this.actions[action](player, args)
				.then(result => {
					// console.log(`[ACTION][${action}][RESULT]`, result);
					return result;
				})
				.catch(err => {
					console.log(`[ACTION][${action}][ERROR]`, err);
					return Promise.reject(err);
				});
			return playerObj;
		}, player);
	}

	requireDir(cwd, cb) {
		fs.readdirSync(cwd)
			.map((name) => {
				const fullPath = path.join(cwd, name);
				return {
					name,
					fullPath,
					stat: fs.statSync(fullPath),
				};
			})
			.filter((file) => {
				return !file.stat.isDirectory() &&
					!file.name.startsWith('.') && file.name.endsWith('.js') &&
					this.actionBlacklist.indexOf(file.name) === -1;
			})
			.forEach((file) => {
				cb(require(file.fullPath));
			});
	}
}

module.exports = NodeAPI;
