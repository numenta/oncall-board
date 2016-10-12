var path = require('path');
var fs = require('fs');
var request = require('request');
var async = require('async');
var _ = require('lodash');
var Handlebars = require('handlebars');
var mainTmpl = Handlebars.compile(
    fs.readFileSync(
        path.join(__dirname, 'templates/main.hbt')
    ).toString()
);
var statusFetchers = [];
var CI_STATUS_URL = 'http://nubot.numenta.org/hubot/ci-status';
// var CI_STATUS_URL = 'http://localhost:8080/hubot/ci-status';
var CI_PLATS = {
    'Bamboo': ['Linux']
  , 'TravisCI': ['OS X']
  , 'AppVeyor': ['Windows']
};

// Set up FIXIE proxying. This is so we can call into AWS for Jenkins/JIRA APIs
// through specific IP addresses set up by Fixie.
console.log("Using FIXIE proxy at %s.", process.env.FIXIE_URL);
proxyRequest = request.defaults({
    'proxy': process.env.FIXIE_URL
});

// URLs we want to monitor.
//_.each([
//    'http://numenta.com',
//    'http://numenta.org',
//    'http://data.numenta.org',
//    'http://tooling.numenta.org/status/',
//    'https://discourse.numenta.org/'
//], function(url) {
//    statusFetchers.push(function(callback) {
//        var status = {
//            name: url,
//            link: url,
//            category: categories.PING
//        };
//        request.get(url, function(err, response) {
//            var state = 'up';
//            if (err || response.statusCode != 200) {
//                state = 'down';
//            }
//            status.description = state;
//            status.status = stateToStatus(state);
//            callback(null, status);
//        });
//    });
//});

function toBootStrapClass(status) {
    switch(status) {
        case 'success':
            return 'success';
        case 'pending':
            return 'warning';
        case 'error':
            return 'error';
        default:
            return 'danger';
    }
}

function errorResponse(err, res) {
    res.end(mainTmpl({
        title: 'ERROR getting status!',
        reports: [{
            slug: 'Error message',
            builds: [{
                name: err.message,
                description: ''
            }]
        }]
    }));
}

function requestHander(req, res) {

    request.get(CI_STATUS_URL, function(err, response, body) {
        var payload, orderedReports = [];

        if (err) {
            return errorResponse(err, res);
        }

        payload = JSON.parse(body)
        _.each(payload, function(buildStatus, slug) {
            buildStatus.slug = slug;
            _.each(buildStatus.builds, function(build, ciPlatform) {
                var platforms
                  ;
                if (ciPlatform == 'status') return;
                platforms = CI_PLATS[ciPlatform].join(',');
                build.name = platforms + ' (' + ciPlatform + ')';
                build.description = build.state || build.status;
                build.link = build.url;
            });
            buildStatus.status = toBootStrapClass(buildStatus.status);
        });

        orderedReports.push(payload['numenta/nupic.core']);
        orderedReports.push(payload['numenta/nupic']);
        orderedReports.push(payload['numenta/nupic.regression']);
        orderedReports.push(payload['numenta/numenta-apps/taurus']);

        res.end(mainTmpl({
            title: 'Numenta On-Call Status',
            reports: orderedReports
        }));

    });

}

module.exports = function() {
    return requestHander;
};
