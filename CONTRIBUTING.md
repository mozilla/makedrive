# How to Contribute

The best way to get started is to read through our README.md file before checking open [issues](https://github.com/mozilla/makedrive/issues). If you would like to have an issue assigned to you, please jump on the Webmaker irc channel (#webmaker on irc.mozilla.org) and someone will help set you up. More details can be found at the [Webmaker Contributor wiki page](https://wiki.mozilla.org/Webmaker/Code)

## Setup

The makedrive build system is based on [grunt](http://gruntjs.com/). To get a working build system
do the following:

```
npm install
npm install -g grunt-cli
```

You can now run the following grunt tasks:
* `grunt test` will run [JSHint](http://www.jshint.com/) on your code and our unit test suite (do this before submitting a pull request) to catch errors

Once you've done some hacking and you'd like to have your work merged, you'll need to
make a pull request. If you're patch includes code, make sure to check that all the
unit tests pass, including any new tests you wrote. Finally, make sure you add yourself
to the `AUTHORS` file.

=======
### Releasing a new version
=======

`grunt publish` will:

* Run the `grunt release` task
* Bump `bower.json` & `package.json` version numbers according to a [Semver](http://semver.org/) compatible scheme (see ["How to Publish"](#how-to-publish) below)
* Create a git tag at the new version number
* Create a release commit including `client/dist/makedrive.js`, `client/dist/makedrive.min.js`, `bower.json` and `package.json`
* Push tag & commit to `upstream/master`
* Publish the new version of the module to NPM

#### How to configure
1. Copy `env.dist` to `.env`
2. Modify as needed, or leave alone for defaults

#### How to Publish
`grunt publish` can be run in four ways:

1.  `grunt publish` - does a patch (x.x.X) bump
2.  `grunt publish:patch` - also does a patch (x.x.X) bump
3.  `grunt publish:minor` - does a minor (x.X.x) bump
4.  `grunt publish:major` - does a major (X.x.x) bump

The user *must* be on their local `master` branch before running any form of `grunt publish`, or else the task will fail loudly.

=======
## Tests

Tests are writting using [Mocha](http://visionmedia.github.io/mocha/) and [Chai](http://chaijs.com/api/bdd/).
You can run the tests in a nodejs context by running `grunt test`.

If you're writing tests, make sure you write them in the same style as existing tests. See `tests/lib/utils.js` and how it gets used in various tests as
an example.

## Communication

If you'd like to talk to someone about the project, you can reach us on irc.mozilla.org in the #nimble or #mofodev channel. Look for "aali" or "humph".
