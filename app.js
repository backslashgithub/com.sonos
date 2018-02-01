'use strict';

const logger = require('homey-log').Log;
const Homey = require('homey');
const SonosSystem = require('sonos-discovery');
const SonosNodeAPI = require('./lib/api/sonos-node-api.js');

const settings = {};
const discovery = new SonosSystem(settings);
const api = new SonosNodeAPI(discovery, settings);
const getIdFromPlaylistUri = new RegExp(/#(\d*)$/);

process.on('unhandledRejection', (reason, p) => {
	console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
	// application specific logging, throwing an error, or other logic here
});

module.exports = class App extends Homey.App {

	onInit() {
		this.SONOS_CODEC = 'sonos:track:uri';

		/*
		 * Homey can periodically request static playlist that are available through
		 * the streaming API (when applicable)
		 */
		Homey.ManagerMedia.on('getPlaylists', this._getPlaylists.bind(this));

		/*
		 * Homey might request a specific playlist so it can be refreshed
		 */
		Homey.ManagerMedia.on('getPlaylist', this._getPlaylist.bind(this));

		/*
		 * Respond to a play request by returning a parsed track object.
		 * The request object contains a trackId and a format property to indicate what specific
		 * resource and in what format is wanted for playback.
		 */
		Homey.ManagerMedia.on('play', (request, callback) => {
			console.log('STREAM', request.trackId, new Buffer(request.trackId, 'base64').toString('ascii'));
			callback(null, { stream_url: new Buffer(request.trackId, 'base64').toString('ascii') });
		});

		api.on('topology-change', () => {
			if ((this.playlistPlayer || {}).uuid !== (this.getPlaylistPlayer() || {}).uuid) {
				Homey.ManagerMedia.requestPlaylistsUpdate();
			}
		});
	}

	getPlaylistPlayer() {
		const players = api.getPlayers();

		// If no players available return an error
		if (!players.length) {
			return new Error('No player available');
		}
		// If the current playlistplayer is no longer available select a new player
		if (!(this.playlistPlayer && players.some(player => player.uuid === this.playlistPlayer.uuid))) {
			this.playlistPlayer = api.getPlayer(players[0].uuid);
		}
		return this.playlistPlayer;
	}

	_getPlaylists(callback) {
		const player = this.getPlaylistPlayer();

		if (player instanceof Error) {
			return callback(player);
		}

		player.actions.playlists('detailed')
			.then(playlists => playlists.map(this._parsePlaylist))
			.then(result => callback(null, result))
			.catch(err => callback(err));
	}

	_parsePlaylist(playlist) {
		return {
			type: 'playlist',
			id: getIdFromPlaylistUri.exec(playlist.uri)[1],
			title: playlist.title,
		};
	}

	_getPlaylist({ playlistId }, callback) {
		const player = this.getPlaylistPlayer();

		if (player instanceof Error) {
			return callback(player);
		}

		player.actions.playlistTracks(playlistId, 'detailed')
			.then(tracks => this._parseTracks(player, playlistId, tracks))
			.then(tracks => callback(null, { id: playlistId, tracks }))
			.catch(err => callback(err));
	}

	_parseTracks(player, playlistId, tracks) {
		if (!tracks) return [];

		return tracks.map(track => {
			const albumArtUri = track.albumArtUri && track.albumArtUri.startsWith('/') ? player.baseUrl + track.albumArtUri : track.albumArtUri;
			const artwork = albumArtUri ? { small: albumArtUri, medium: albumArtUri, large: albumArtUri } : undefined;
			return {
				type: 'track',
				id: new Buffer(track.id || `SQ:${playlistId}/${track.uri}`).toString('base64'),
				duration: track.duration * 1000,
				title: track.title,
				artist: track.artist ? [{ type: 'artist', name: track.artist }] : undefined,
				album: track.album,
				artwork,
				codecs: [this.SONOS_CODEC],
				confidence: 0.5,
			};
		});
	}

	onDeviceAdded() {
		if (this.playlistLock) {
			this.playlistLock = 0;
			Homey.manager('media').requestPlaylistsUpdate();
		}
	}

	onDeviceDeleted() {
		if (!this.getFirstDevice()) {
			this.playlistLock = 2;
			Homey.manager('media').requestPlaylistsUpdate();
		}
	}

	getApi() {
		return api;
	}

	restartApi() {
		if (api.discovery.subscriber) {
			api.discovery.subscriber.emit('dead');
		} else {
			api.setDiscovery(new SonosSystem());
		}
	}
};
