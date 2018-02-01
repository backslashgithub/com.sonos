'use strict';
function playlistTracks(player, values) {
	const playlistId = values[0];

	return player.browseAll(`SQ:${playlistId}`)
		.then((tracks) => {
			if (values[1] === 'detailed') {
				return tracks;
			}

			// only present relevant data
			var simpleTracks = [];
			tracks.forEach(function (i) {
				simpleTracks.push(i.title);
			});

			return simpleTracks;
		});
}

module.exports = (api) => {
	api.registerAction('playlistTracks', playlistTracks);
};
