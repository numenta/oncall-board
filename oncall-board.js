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

function stateToStatus(state) {
    switch(state) {
        case 'success':
        case 'passed':
        case 'up':
        case 'identical':
        case 'Successful':
            return 'success';
        case 'failure':
        case 'failed':
        case 'Failed':
            return 'failure';
        case 'error':
        case 'errored':
        case 'err':
            return 'error';
        case 'pending':
        case 'started':
        case 'running':
        case 'queued':
        case 'created':
            return 'pending';
        default:
            console.warn('Unknown state "%s"', state);
            return 'unknown';
    }
}

// TODO: important
// , 'TAUR-TAUR': 'Taurus (Bamboo)'
// , 'UN-UN': 'Unicorn (Bamboo)'

// Gets complete CI status from Nubot service.
statusFetchers.push(function(callback) {
    request.get(CI_STATUS_URL, function(err, response, body) {
        if (err) return callback(err);
        var statuses = []
          , payload = JSON.parse(body)
          ;
        _.each(payload, function(builds, slug) {
            _.each(builds, function(build, ciPlatform) {
                var status = {}
                  , platforms = CI_PLATS[ciPlatform].join(',')
                  ;
                status.name = platforms + ' (' + ciPlatform + ')';
                status.status = stateToStatus(build.state);
                status.description = build.state;
                status.link = build.url;
                status.category = slug;
                statuses.push(status);
            });
        });
        callback(null, statuses);
    });
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


function sortReportsByCategory(reports) {
    var out = {};
    _.each(reports, function(report) {
        var category = report.category;
        if (! out[category]) {
            out[category] = []
        }
        out[category].push(report);
    });
    _.each(_.keys(out), function(category) {
        out[category] = _.sortBy(out[category], function(report) {
            return report.name;
        });
    });
    return out;
}

function requestHander(req, res) {
    async.parallel(statusFetchers, function(err, reports) {
        if (err) throw err;
        reports = _.flatten(reports);
        reports = sortReportsByCategory(reports);
        res.end(mainTmpl({
            title: 'Numenta On-Call Status',
            reports: reports,
            columnWidth: 12 / _.size(reports)
        }));
    });
}

module.exports = function() {
    return requestHander;
};
