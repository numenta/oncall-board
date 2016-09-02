var path = require('path');
var fs = require('fs');
var request = require('request');
var proxyRequest = request;
var async = require('async');
var _ = require('lodash');
var Handlebars = require('handlebars');
var GH_USERNAME = process.env.GH_USERNAME;
var GH_PASSWORD = process.env.GH_PASSWORD;
var AppVeyor = require('appveyor-js-client');
var mainTmpl = Handlebars.compile(
    fs.readFileSync(
        path.join(__dirname, 'templates/main.hbt')
    ).toString()
);
var statusFetchers = [];
var appveyor = new AppVeyor('numenta');
var appveyorProjects = undefined;

var BAMBOO_URL = encodeURI('https://ci.numenta.com/rest/api/latest/result.json');
var bambooJobs = undefined;

//var JIRA_USER = process.env.JIRA_USERNAME;
//var JIRA_PASS = process.env.JIRA_PASSWORD;
//var JQL = 'status in (New, "In Progress", Reopened, Blocked, "Selected for Development", "Ready for Development", "In Review") AND priority in ("P1 - Critical", "P2 - Blocker")';
//var JIRA_URL = encodeURI('http://' + JIRA_USER + ':' + JIRA_PASS + '@jira.numenta.com/rest/api/2/search?jql=' + JQL);

var categories = {
    OS: 'Core OS Pipelines',
    JENKINS: 'Jenkins',
    BAMBOO: 'Bamboo',
    PING: 'Ping'
};

// Set up FIXIE proxying. This is so we can call into AWS for Jenkins/JIRA APIs
// through specific IP addresses set up by Fixie.
console.log("Using FIXIE proxy at %s.", process.env.FIXIE_URL);
proxyRequest = request.defaults({
    'proxy': process.env.FIXIE_URL
});

function stateToStatus(state) {
    var numIssues;
    if (_.endsWith(state, 'issues')) {
        numIssues = parseInt(state.split(/\s+/).shift());
        if (numIssues > 5) {
            return 'danger';
        } else {
            return 'warning';
        }
    }
    switch(state) {
        case 'passed':
        case 'success':
        case 'blue':
        case 'blue_anime':
        case 'up':
        case 'identical':
        case 'Successful':
            return 'success';
        case 'started':
        case 'running':
        case 'queued':
        case 'created':
            return 'info';
        case 'warning':
        case 'yellow':
        case 'yellow_anime':
        case 'unknown':
            return 'warning';
        default:
            return 'danger';
    }
}

function getLastTravisMasterBuildState(slug, callback) {
    var url = 'https://api.travis-ci.org/repos/' + slug + '/branches/master';
    request.get(url, function(err, payload) {
        if (err) { return callback(err); }
        callback(null, JSON.parse(payload.body).branch.state);
    });
}

function getAppVeyorProject(slug, callback) {
    if (! appveyorProjects) {
        appveyor.getProjects(function(err, projects) {
            if (err) { return callback(err); }
            var target = _.find(projects, function(project) {
                return project.repoSlug == slug;
            });
            callback(null, target);
        });
    } else {
        callback(null, appveyorProjects);
    }
}

function findTargetBambooJob(name, callback) {
    var targetJob = _.find(bambooJobs, function(job) {
        return job.plan.key == name;
    });
    callback(null, targetJob);
}

function getBambooJob(name, callback) {
    if (! bambooJobs) {
        proxyRequest.get(BAMBOO_URL, function(err, response) {
            if (err) return callback(err);
            try {
                bambooJobs = JSON.parse(response.body).results.result;
            } catch(error) {
                return callback(error);
            }
            findTargetBambooJob(name, callback);
        });
    } else {
        findTargetBambooJob(name, callback);
    }
}

function sortReportsByCategory(reports) {
    var out = {};
    _.each(reports, function(report) {
        var category = report.category;
        if (! out[category]) {
            out[category] = []
        }
        out[category].push(report);
    });
    return out;
}

// Travis CI builds to monitor.
_.each({
    'numenta/nupic': 'NuPIC Travis CI',
    'numenta/nupic.core': 'NuPIC Core Travis CI',
    'numenta/nupic.regression': 'NuPIC Regression Tests'
}, function(title, slug) {
    statusFetchers.push(function(callback) {
        var status = {
            name: title,
            link: 'https://travis-ci.org/' + slug,
            category: categories.OS
        };
        getLastTravisMasterBuildState(slug, function(err, state) {
            if (err) {
                status.status = stateToStatus('unknown');
                status.description = 'unknown';
                return callback(null, status);
            }
            status.description = state;
            status.status = stateToStatus(state);
            callback(null, status);
        });
    });

});

// AppVeyor builds to monitor
_.each({
    'numenta/nupic': 'NuPIC AppVeyor',
    'numenta/nupic.core': 'NuPIC Core AppVeyor'
}, function(title, slug) {
    statusFetchers.push(function(callback) {
        var status = {
            name: title,
            link: 'https://ci.appveyor.com/project/numenta-ci/' + slug.split('/').pop() + '/history',
            category: categories.OS
        };
        getAppVeyorProject(slug, function (err, project) {
            if (err) {
                status.status = stateToStatus('unknown');
                status.description = 'unknown';
                return callback(null, status);
            }
            project.getLastBuildBranch('master', function (err, response) {
                if (err) {
                    return callback(err);
                }
                status.description = response.build.status;
                status.status = stateToStatus(response.build.status);
                callback(null, status);
            });
        });
    });
});

// Adds status fetchers for each Bamboo job we want to monitor
_.each({
    'NUP-PY': 'NuPIC',
    'NUP-CORE': 'NuPIC Core',
    'TAUR-TAUR': 'Taurus',
    'UN-UN': 'Unicorn'
}, function(title, jobName) {
    statusFetchers.push(function(callback) {
        var status = {
            name: title,
            category: categories.BAMBOO
        };
        getBambooJob(jobName, function(err, job) {
            if (err) {
                status.status = stateToStatus('unknown');
                status.description = 'unknown';
                return callback(null, status);
            }
            status.description = job.state;
            status.status = stateToStatus(job.state);
            status.link = job.link.href;
            callback(null, status);
        });
    });
});

// URLs we want to monitor.
_.each([
    'http://numenta.com',
    'http://numenta.org',
    'http://data.numenta.org',
    'http://tooling.numenta.org/status/',
    'https://discourse.numenta.org/'
], function(url) {
    statusFetchers.push(function(callback) {
        var status = {
            name: url,
            link: url,
            category: categories.PING
        };
        request.get(url, function(err, response) {
            var state = 'up';
            if (err || response.statusCode != 200) {
                state = 'down';
            }
            status.description = state;
            status.status = stateToStatus(state);
            callback(null, status);
        });
    });
});

// High priority JIRA issues.

// TODO: fix this

//statusFetchers.push(function(callback) {
//    var status = {
//        name: 'P1/P2 JIRA Issues',
//        link: 'https://jira.numenta.com/secure/RapidBoard.jspa?rapidView=40&quickFilter=418',
//        category: categories.NUMENTA
//    };
//    console.log(JIRA_URL);
//    proxyRequest.get(JIRA_URL, function(err, response) {
//        if (err) { return callback(err); }
//        console.log(response.body);
//        var totalIssues = JSON.parse(response.body).total;
//        status.description = totalIssues + ' issues';
//        status.status = stateToStatus(totalIssues + ' issues');
//        callback(null, status);
//    });
//});

function requestHander(req, res) {
    async.parallel(statusFetchers, function(err, reports) {
        if (err) throw err;
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
