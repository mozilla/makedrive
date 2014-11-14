## MakeDrive Authentication

MakeDrive requires users to be authenticated in order to sync their filesystem, or to access various routes (e.g., `/p/*`).  It does not, however, provide any mechanism for logging in or logging out--this needs to get handled by the application using MakeDrive.

MakeDrive expects a user to already be authenticated, and specifically, to have a unique username.  This username is used to separate one user's filesystem data from another.

MakeDrive can be taught to use various authentication strategies, and ships with a few different options for you to use during development or testing.

## Authentication Providers

MakeDrive achieves its swappable authentication ability by relying on [Passport.js](http://passportjs.org) for its authentication middleware.  Authentication Providers are wrappers around [Passport.js](http://passportjs.org) providers, which in turn implement various authentication strategies using a common interface.

All supported Authentication Providers are stored in the [server/authentication/providers](./providers) directory.  At runtime the server determines which Authentication Provider to use by inspecting the `AUTHENTICATION_PROVIDER` environment variable (i.e., set in your `.env` file), which should be set to the filename  of the provider to use.  For example, the default provider is [server/authentication/providers/passport-zeroconfig](./providers/passport-zeroconfig.js), which is chosen with `AUTHENTICATION_PROVIDER="passport-zeroconfig"`.

## Default Authentication Providers

A number of Authentication Providers ship with MakeDrive for reference and to make development and testing easier.  Each one is documented in the source.

The default provider, `passport-zeroconfig`, is meant for development only, and provides automatic and transparent authentication for a user named `'root'`.  This is useful for cases where you don't want to, or haven't yet, implemented an authentication mechanism for your app.

The `passport-env` and `passport-query-string` providers are similar, but allow you to specify `PASSPORT_USERNAME` and `PASSPORT_PASSWORD` in your `.env` file, thus creating a single/specific user account.

The `passport-github` and `passport-webmaker` providers show how to use a common third-party authentication service, one with relies on an OAuth flow and the other cookie-based session secrets.

## Implementing an Authentication Provider

Most users of MakeDrive will need to implement something specific to their app and environment.  Doing so means creating a new file in [server/authentication/providers](./providers) and possibly [server/authentication/passport-strategies](./passport-strategies).

An Authentication Provider, `provider`, needs to implement the following:

* `provider.name` [`String`]: the name of the [Passport.js Provider Strategy](http://passportjs.org/guide/authenticate/) to pass to the `passport.authenticate(...)` method (e.g., `'local'`).
* `provider.init(app)` [`Function`]: an initialization function to call prior to Passport.js being initialized. This gives your Authentication Provider a chance to do any necessary setup, as well as adding any extra middleware to the Express `app` instance.  

## Contributing

If you've written an Authentication Provider that you think would be useful to other MakeDrive users, please consider sending a pull request.
