=== Sustainability Data (well-known) ===
Contributors: andreibesleaga
Tags: sustainability, carbon, energy, well-known, esg
Requires at least: 6.4
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 0.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Publishes your site's energy and carbon figures at /.well-known/sustainability-data, in the format of an IETF Internet-Draft.

== Description ==

The Internet-Draft draft-besleaga-sustainability-wellknown (under review at the IETF Independent Submissions Editor;
not yet an RFC) defines one place, `/.well-known/sustainability-data`, where a site publishes its sustainability
figures in a machine-readable form. This plugin serves that file from your own domain, from figures you type in once (and update
when you have new ones): provider, methodology page, reporting period, energy, carbon, scopes, a disclosure link.

* Serves the draft's media type with the right caching and CORS headers; answers HEAD and 405 correctly.
* Signs the declaration with an Ed25519 key generated on your site at activation (the public key travels inside
  the signature); nothing to configure.
* Makes no external calls, sets no cookies, collects nothing.
* Checks what you type: until the required fields are valid the settings page says what is missing and the
  address answers 404, so a half-filled form is never published.
* Works on multisite: network activation sets up every site, and sites added later.
* Translation-ready (text domain `sustainability-data-wellknown`).

Check your file with the reference consumer: `npx -y -p sustainability-wellknown-consumer sustainability-fetch https://your-site --strict`.

== Installation ==

1. Install and activate. (Permalinks must be enabled: Settings → Permalinks, anything but "Plain".)
2. Settings → Sustainability data: fill in provider, methodology page, reporting period and measurement method
   (all required), then at least one of energy, carbon or a disclosure page. Save.
3. Open https://your-site/.well-known/sustainability-data. Until the required fields are valid it answers 404
   and the settings page lists what to fix.

== Frequently Asked Questions ==

= Where do the figures come from? =
From you. The plugin publishes what you enter; the methodology page you link should say how you obtained it.

= What does "measurement method" mean? =
How the figures were obtained: `hardware-metered` only for a meter reading; `hardware-estimated` for counters or
sensors that estimate; `cloud-billing` for a provider's own footprint report; `third-party-modeled` for a model or
a calculator. Nothing is preselected, because the choice is a claim you make.

= Is a hosting provider's "green" badge a figure? =
No. Enter energy or carbon numbers you have, or only a disclosure link to your report.

= What does the signature prove? =
That the file was not altered since this site produced it. Nothing about accuracy.

== Changelog ==

= 0.1.0 =
* First release.
