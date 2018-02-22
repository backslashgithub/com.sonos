'use strict';
function playlistTracks(player, values) {
	const playlistId = values[0];

	return player.browseAll(`SQ:${playlistId}`)
		.then((tracks) => {
			if (values[1] === 'detailed') {
				return tracks;
			}

			// only present relevant data
			return tracks
				.map(track => track.title);
		});
}

module.exports = (api) => {
	api.registerAction('playlistTracks', playlistTracks);
};
