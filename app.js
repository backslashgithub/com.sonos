'use strict';

const logger = require('homey-log').Log;
const Homey = require('homey');
const SonosSystem = require('sonos-discovery');
const SonosNodeAPI = require('./lib/api/sonos-node-api.js');

const getIdFromPlaylistUri = new RegExp(/#(\d*)$/);

module.exports = class App extends Homey.App {

	onInit() {
		/*
		 * Constant key used for sonos codec uri
		 */
		this.SONOS_CODEC = 'sonos:track:uri';

		/*
		 * The Sonos connection api
		 */
		const discovery = new SonosSystem({});
		this.api = new SonosNodeAPI(discovery, {});

		/*
		 * Homey can periodically request static playlist that are available through
		 * the streaming API (when applicable)
		 */
		Homey.ManagerMedia.on('getPlaylists', (callback) =>
			this._getPlaylists()
				.then(res => callback(null, res))
				.catch(callback)
		);

		/*
		 * Homey might request a specific playlist so it can be refreshed
		 */
		Homey.ManagerMedia.on('getPlaylist', (query, callback) =>
			this._getPlaylist(query)
				.then(res => callback(null, res))
				.catch(callback)
		);

		/*
		 * Respond to a play request by returning a parsed track object.
		 * The request object contains a trackId and a format property to indicate what specific
		 * resource and in what format is wanted for playback.
		 */
		Homey.ManagerMedia.on('play', (request, callback) => {
			callback(null, { stream_url: new Buffer(request.trackId, 'base64').toString('ascii') });
		});

		this.api.on('topology-change', () => {
			if ((this.playlistPlayer || {}).uuid !== (this.getPlaylistPlayer() || {}).uuid) {
				Homey.ManagerMedia.requestPlaylistsUpdate();
			}
		});
	}

	getPlaylistPlayer() {
		const players = this.api.getPlayers();

		// If no players available return an error
		if (!players.length) {
			return new Error('No player available');
		}
		// If the current playlistplayer is no longer available select a new player
		if (!(this.playlistPlayer && players.some(player => player.uuid === this.playlistPlayer.uuid))) {
			this.playlistPlayer = this.api.getPlayer(players[0].uuid);
		}
		return this.playlistPlayer;
	}

	_getPlaylists() {
		const player = this.getPlaylistPlayer();

		if (player instanceof Error) {
			return Promise.reject(player);
		}

		return player.actions.playlists('detailed')
		//.then(playlists => playlists.map(this._parsePlaylist)) // TODO enable when media api changes in 1.5.8
			.then(playlists => Promise.all(playlists.map(async (playlist) => {
				const playlistData = this._parsePlaylist(playlist);
				const trackData = await this._getPlaylist({ playlistId: playlistData.id });
				return Object.assign(playlistData, trackData);
			})));
	}

	_parsePlaylist(playlist) {
		return {
			type: 'playlist',
			id: getIdFromPlaylistUri.exec(playlist.uri)[1],
			title: playlist.title,
		};
	}

	_getPlaylist({ playlistId }) {
		const player = this.getPlaylistPlayer();

		if (player instanceof Error) {
			return Promise.reject(player);
		}

		return player.actions.playlistTracks(playlistId, 'detailed')
			.then(tracks => this._parseTracks(player, playlistId, tracks))
			.then(tracks => ({ id: playlistId, tracks }));
	}

	_parseTracks(player, playlistId, tracks) {
		if (!tracks) return [];

		return tracks.map(track => {
			const albumArtUri = track.albumArtUri && track.albumArtUri.startsWith('/') ? player.baseUrl + track.albumArtUri : track.albumArtUri;
			const artwork = albumArtUri ? { small: albumArtUri, medium: albumArtUri, large: albumArtUri } : undefined;
			return {
				type: 'track',
				id: new Buffer(track.id || `SQ:${playlistId}!${track.uri}`).toString('base64'),
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

	getApi() {
		return this.api;
	}

	restartApi() {
		if (this.api.discovery.subscriber) {
			this.api.discovery.subscriber.emit('dead');
		} else {
			this.api.setDiscovery(new SonosSystem());
		}
	}
};
