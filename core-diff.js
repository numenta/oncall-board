var githubAPI = require('github'),
    github = new githubAPI({
      version: '3.0.0',
      timeout: 5000
    }),
    OWNER = 'numenta';

function getContents(repo, path, callback) {
    github.repos.getContent({
        user: OWNER,
        repo: repo,
        path: path
    }, function(err, contentResponse) {
        var contents;
        if (err) { return callback(err); }
        contents = new Buffer(contentResponse.content, 'base64').toString();
        callback(null, contents);
    });
}

function compareCommits(repo, base, head, callback) {
    github.repos.compareCommits({
        user: OWNER,
        repo: repo,
        base: base,
        head: head
    }, callback);
}

module.exports = function(ghUser, ghPass) {
    github.authenticate({
        type: 'basic',
        username: ghUser,
        password: ghPass
    });
    return {
        contents: getContents,
        compare: compareCommits
    };
};