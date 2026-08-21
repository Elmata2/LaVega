# No patent application; the EU database right, trade secret and a trademark instead

Asked on 21 August 2026, with PSD3 in mind: can we patent what LaVega does, given
that around 2030 every bank will have to expose an API and the access side becomes
a commodity?

**No patent.** Not because the timing is wrong, but because what LaVega does is
mostly not patentable subject matter in Europe, and the instruments that *do* fit
are cheaper, faster and already partly in place.

This is not legal advice and nobody here is a patent attorney. A filing decision
needs a Dutch or European one. What follows is the reasoning, so the question does
not have to be re-litigated from scratch.

## The one thing that would have been fatal, and is not

Article 54 EPC applies **absolute novelty**: any disclosure anywhere, by anyone
*including the inventor*, before the filing date destroys it. Unlike the United
States there is no grace period.

Checked on 21 August 2026: the GitHub repository is **private**, and the landing
page is waitlist-only — only the header "Inloggen" enters the vault, so the app
itself has not been shown publicly. Novelty on the technical mechanisms is
therefore most likely still intact.

Recorded here because it is the one property that cannot be recovered once lost.
Any future decision to open the repository or open the app to the public is also a
decision to give up patentability, and should be made knowing that.

## Why a patent still fails

**Article 52(2) EPC excludes** methods for doing business (c) and the presentation
of information (d), "as such". Ranking bank tariffs, distinguishing unknown from
zero, refusing a figure whose conditions are not established, building a
catalogue of product terms — that is the excluded category almost exactly. It is
what makes LaVega good; it is not what makes it patentable.

**What does have technical character** is the architecture: a vault encrypted in
the browser, and an LLM proxy that redacts before anything leaves the device
(only `{id,text,sign}`, with IBANs, amounts and dates scrubbed). The EPO does
grant patents on security mechanisms. But client-side encryption and PII
redaction ahead of a language model are heavily prior-arted by 2026; inventive
step is where this would die, and dying at inventive step costs the same as
winning.

**The price of trying**: roughly €10–15k in attorney fees plus EPO fees, three to
five years to grant, then per-country translation and renewal costs. And
publication at 18 months is not optional — the application discloses the method to
every competitor in exchange for a right that may not be granted. For a catalogue
whose value is partly in *which routes work*, that trade is bad on its own terms.

## Why the PSD3 argument points the other way

Mandatory bank APIs make **access** a commodity: everyone gets the same door. That
is precisely why the bottleneck moves to what is done with the data — and here
that is the catalogue: 122+ products, each figure carrying value, source, date and
conditions, gathered over routes that mostly had to be discovered.

A patent on "use bank APIs to rank fees" is the business-method exclusion
restated. The catalogue, however, fits a different right almost perfectly.

## What we use instead

**The EU database right** (Directive 96/9/EC, implemented in the Dutch
Databankenwet). It protects a substantial investment in *obtaining, verifying or
presenting* the contents of a database — which is a literal description of the
sweep, including the verification pass and the refusals. Fifteen years from
completion, renewed by substantial changes, **no registration and no fee**. It
does not protect the idea, and it does not need to: it protects the asset that
took the work.

**Trade secret** on the method. The four working routes (mandated fee documents as
static PDFs, the site's own payload JSON, the reader proxy, Wayback CDX) and the
recorded dead ends (headless Chrome, Apify, restcountries) are the most valuable
thing in the repository, because they are what a competitor would have to spend
the same weeks to rediscover. Keeping the repository private is already this
measure; it is worth knowing that it *is* a measure and not just a default.

**A trademark** on LaVega. Around €850 at the EUIPO, genuinely enforceable, and
useful immediately rather than in four years.

**Speed.** The moat is that the catalogue is already built and keeps being
verified.

## One interaction worth knowing

**AGPLv3 §11 grants every user a royalty-free patent licence** covering the
licensed code. A patent and an AGPL release of the same mechanism work against
each other. LaVega currently carries AGPL-3.0 with a private repository — the
licence binds only those who receive the code, so nothing is granted yet, but
publishing under AGPL later would grant it.

## Consequences

- No patent search, no attorney, no filing. Revisit only if a genuinely technical
  mechanism appears that is novel over 2026 prior art — and before it ships.
- Treat the repository's privacy as an IP measure, not a convenience.
- The sweep's provenance discipline (value + source + date + conditions, and the
  logged dead ends) is what evidences the "substantial investment" the database
  right requires. It is worth keeping the merge reports for that reason alone.
- Register the trademark before the app opens to the public.
