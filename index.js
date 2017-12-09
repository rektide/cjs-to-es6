#!/usr/bin/env node

var lie = require('lie');
if (typeof Promise === 'undefined') {
  global.Promise = lie;
}
var denodeify = require('denodeify');
var findit = require('findit');
var fs = require('fs');
var statAsync = denodeify(fs.stat);
var existsAsync = denodeify(fs.exists);
var spawn = require('child-process-promise').spawn;
var flatten = require('lodash.flatten');
var uniq = require('uniq');
var path = require('path');
var colors = require('colors/safe');
var yargs = require('yargs')
  .usage('Usage: $0 [ files/directories ... ]')
  .boolean('h')
  .alias('h', 'help')
  .describe('h', 'show help message')
  .default('renameImportSource', ()=> (console.log("sup"), '@(.*)/_$1/'), 'use this search/replace regex to transform source of imports')
  .boolean('verbose')
  .describe('verbose', 'show verbose output')
  .default('verbose', false)
  .example('$0 index.js', 'convert a single file')
  .example('$0 lib/', 'convert all files in a directory')
  .example('$0 foo.js bar.js lib/', 'convert many files/directories')
  ;

var files = yargs.argv._;
var verbose = yargs.argv.verbose;

if (yargs.argv.h || !files.length) {
  console.log('\ncjs-to-es6 v' + require('./package.json').version + ': ' +
    require('./package.json').description + '\n');
  yargs.showHelp();
  process.exit(0);
}

function findJsFiles(dir) {
  return new Promise(function (resolve, reject) {
    var files = [];
    findit(dir).on('file', function (file) {
      // only return files ending in .js
      if (/\.js$/.test(file)) {
        files.push(file);
      }
    }).on('end', function () {
      resolve(files);
    }).on('error', reject);
  });
}

function runCodeshift(transformFile, files, supplementaryArgs) {
  var cmd = require.resolve("jscodeshift/bin/jscodeshift.sh");
  var transform = require.resolve(transformFile);
  var args = ["-t", transform].concat(supplementaryArgs|| []).concat(files);
  var child = spawn(cmd, args);
  child.progress(function (childProcess) {
    if (verbose) {
      childProcess.stdout.pipe(process.stdout);
    } else {
      childProcess.stdout.on('data', function (data) {
        if (/^Results: /.test(String(data))) {
          console.log(String(data).replace(/\n$/, ''));
        }
      });
    }
    childProcess.stderr.pipe(process.stderr);
  });
  return child;
}

function derequireify(files) {
  console.log('\nTransforming ' + colors.yellow('require()') + ' to ' +
    colors.cyan('import') + ' ...');
  return runCodeshift('5to6-codemod/transforms/cjs.js', files);
}

function deexportify(files) {
  console.log('\nTransforming ' + colors.yellow('module.exports') + '/' +
    colors.red('exports') + ' to ' +
    colors.cyan('export') + ' ...');
  return runCodeshift('5to6-codemod/transforms/exports.js', files);
}

function renameImportSource(files) {
  console.log('\nTransforming ' + colors.yellow('import source names') + ' ...');
  return runCodeshift('rename-imports-codemod', files, ["--renameImportSource=" + yargs.argv.renameImportSource]);
}

Promise.resolve().then(function () {
  console.log(colors.rainbow('\nAhoy!') + ' ES6ifyin\' your CommonJS for ya...');
  return Promise.all(files.map(function (file) {
    file = path.resolve(file);
    return existsAsync(file).catch(function (exists) {
      if (!exists) {
        throw new Error('file not found: ' + file);
      }
    }).then(function () {
      return statAsync(file);
    }).then(function (stat) {
      if (stat.isDirectory()) {
        return findJsFiles(file);
      }
      return [file];
    });
  })).then(flatten).then(uniq);
}).then(function (files) {
  console.log('\nFound ' + colors.cyan(files.length.toString()) + ' files.');
  return derequireify(files).then(function () {
    return deexportify(files).then(function () {
      return renameImportSource(files);
    })
  })
}).catch(function (err) {
  if (err.errno == 'E2BIG') {
    throw new Error('Sorry, too many files at once');
  }
  throw err;
}).then(function () {
  console.log(colors.rainbow('\nES6ification complete!'));
  if (!verbose) {
    console.log('Re-run with ' + colors.cyan('--verbose') +
      ' to see full output.');
  }
  console.log();
}).catch(function (err) {
  console.log(err.stack);
  process.exit(1);
});