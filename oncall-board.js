var path = require('path');
var fs = require('fs');
var request = require('request');
var async = require('async');
var _ = require('lodash');
var Handlebars = require('handlebars');
var GH_USERNAME = process.env.GH_USERNAME;
var GH_PASSWORD = process.env.GH_PASSWORD;
var AppVeyor = require('appveyor-js-client');
var coreDiff = require('./core-diff')(GH_USERNAME, GH_PASSWORD);
var mainTmpl = Handlebars.compile(
    fs.readFileSync(
        path.join(__dirname, 'templates/main.hbt')
    ).toString()
);
var statusFetchers = [];
var appveyor = new AppVeyor('numenta');
var appveyorProjects = undefined;

var JENKINS_USER = process.env.JENKINS_USERNAME;
var JENKINS_PASS = process.env.JENKINS_PASSWORD;
var JENKINS_URL = 'http://' + JENKINS_USER + ':' + JENKINS_PASS + '@jenkins-master.numenta.com/api/json';
var jenkinsJobs = undefined;

var JIRA_USER = process.env.JIRA_USERNAME;
var JIRA_PASS = process.env.JIRA_PASSWORD;
var JQL = 'status in (New, "In Progress", Reopened, Blocked, "Selected for Development", "Ready for Development", "In Review") AND priority in ("P1 - Critical", "P2 - Blocker")';
var JIRA_URL = 'https://' + JIRA_USER + ':' + JIRA_PASS + '@jira.numenta.com/rest/api/2/search?jql=' + JQL;

var categories = {
    NUPIC: 'NuPIC',
    NUMENTA: 'Numenta',
    PING: 'Ping'
};

// Set up FIXIE if it is enabled
if (process.env.FIXIE_URL) {
    console.log("Using FIXIE proxy at %s.", process.env.FIXIE_URL);
    request = request.defaults({
        'proxy': process.env.FIXIE_URL
    })
}

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
        case 'up':
        case 'identical':
        case '0 issues':
            return 'success';
        case 'started':
        case 'running':
        case 'queued':
            return 'info';
        case 'warning':
        case '1 issues':
        case '2 issues':
            return 'warning';
        default:
            return 'danger';
    }
}

function aheadByToStatus(aheadBy) {
    if (aheadBy > 10) {
        return 'danger';
    } else if (aheadBy > 5) {
        return 'warning';
    }
    return 'success';
}

function getLastTravisMasterBuildState(slug, callback) {
    var url = 'https://api.travis-ci.org/repos/' + slug + '/branches/master';
    request.get(url, function(err, payload) {
        if (err) { return callback(err); }
        callback(null, JSON.parse(payload.body).branch.state);
    });
}

function extractNupicCoreSha(moduleData) {
    return moduleData.replace(/\s+/g, '')
        .split('NUPIC_CORE_COMMITISH=\'')
        .pop().split('\'').shift();
}

function getNupicCoreSyncState(callback) {
    coreDiff.contents('nupic', '.nupic_modules', function(err, nupicModules) {
        if (err) { return callback(err); }
        var sha = extractNupicCoreSha(nupicModules);
        coreDiff.compare('nupic.core', sha, 'HEAD', callback);
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

function findTargetJenkinsJob(name, callback) {
    var targetJob = _.find(jenkinsJobs, function(job) {
        return job.name == name;
    });
    if (! targetJob) {
        callback(new Error('No Jenkins job found matching "' + name + '"!'));
    } else {
        callback(null, targetJob);
    }
}

function getJenkinsJob(name, callback) {
    if (! jenkinsJobs) {
        request.get(JENKINS_URL, function(err, response) {
            if (err) { return callback(err); }
            jenkinsJobs = JSON.parse(response.body).jobs;
            findTargetJenkinsJob(name, callback);
        });
    } else {
        findTargetJenkinsJob(name, callback);
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
            category: categories.NUPIC
        };
        getLastTravisMasterBuildState(slug, function(err, state) {
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
            category: categories.NUPIC
        };
        getAppVeyorProject(slug, function (err, project) {
            if (err) {
                return callback(err);
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

// The NuPIC / NuPIC Core sync status.
statusFetchers.push(function(callback) {
    var status = {
        name: 'NuPIC Core Sync Status',
        link: 'http://status.numenta.org/monitor/core_sha_diff',
        category: categories.NUPIC
    };
    getNupicCoreSyncState(function(err, comparison) {
        if (err) { return callback(err); }
        var description = comparison.status;
        if (comparison.status == 'ahead') {
            description = 'ahead by ' + comparison.ahead_by;
        }
        status.description = description;
        status.status = aheadByToStatus(comparison.ahead_by);
        callback(null, status);
    });
});


// Adds status fetchers for each Jenkins job we want to monitor.
_.each({
    'htm-it-mobile-product-pipeline': 'HTM for IT Mobile Product Pipeline',
    'htm-it-product-pipeline': 'HTM for IT Product Pipeline',
    'infrastructure-python-pipeline': 'Infrastructure Python Pipeline',
    'nupic-product-pipeline': 'NuPIC Product Pipeline',
    'product-master-build': 'Product Master Build',
    'refresh-taurus-servers': 'Refresh Taurus Servers',
    'taurus-mobile-product-pipeline': 'Taurus Mobile Product Pipeline',
    'terminate-stale-EC2-instances': 'Terminate Stale EC2 Instances'
}, function(title, jobName) {
    statusFetchers.push(function(callback) {
        var status = {
            name: title,
            category: categories.NUMENTA
        };
        getJenkinsJob(jobName, function(err, job) {
            if (err) { return callback(err); }

            // red_anime.gif
            status.description = '<img src="/static/img/jenkins/' + job.color + '.gif"/>';

            status.status = stateToStatus(job.color);
            status.link = job.url;
            callback(null, status);
        });
    });
});

// URLs we want to monitor.
_.each([
    'http://numenta.com', 'http://numenta.org', 'http://data.numenta.org'
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

//// High priority JIRA issues.
//statusFetchers.push(function(callback) {
//    var status = {
//        name: 'P1/P2 JIRA Issues',
//        link: 'https://jira.numenta.com/secure/RapidBoard.jspa?rapidView=40&quickFilter=418',
//        category: categories.NUMENTA
//    };
//    request.get(JIRA_URL, function(err, response) {
//        if (err) { return callback(err); }
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