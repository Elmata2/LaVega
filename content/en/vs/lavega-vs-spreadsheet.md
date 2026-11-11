---
id: vs-excel
family: vs
title: "LaVega vs a spreadsheet"
description: "A fair comparison of tracking your money in a spreadsheet and in LaVega: flexibility and cost on one side, import, forecast and categorisation on the other."
status: draft
author: alexander
updated: 2026-10-26
sources:
  - { title: "LaVega: product description and FAQ", url: "https://www.lavega.dev/en", accessed: 2026-10-26 }
faq:
  - { q: "Can I just track my finances in Excel?", a: "Yes. A spreadsheet gives you full freedom over layout and calculations and costs nothing extra if you already have Excel or a free alternative. It does take time to enter or import and categorise transactions." }
  - { q: "What does LaVega do differently from a spreadsheet?", a: "LaVega imports bank exports or reads your account read-only, categorises transactions automatically, shows accounts and investments in one view and forecasts your cash position. It gives information, not financial advice." }
---

Many people start with a spreadsheet, and it is a perfectly good way to get a grip on your money. This page sets side by side what a home-made sheet does well and what LaVega does differently. There is no winner: it depends on what you want to track and how much time you want to spend on it.

## Where a spreadsheet is strong

- **Freedom.** You decide the columns, formulas and charts. An unusual situation, such as your own company, a rental flat or a non-standard yearly rhythm, fits because you design it.
- **Cost.** If you already have Excel, or use a free spreadsheet, there is no extra cost.
- **Visible calculations.** You see every formula. Nothing happens in a black box.
- **No connections.** Your data sits in a file that you control.
- **Portable.** You can share a file with a partner or accountant and change it yourself.

## Where the work is

A spreadsheet is only as good as the upkeep you put in. That shows mostly here:

- **Input.** Downloading exports every month, rearranging columns and pasting new rows takes time, especially with several banks.
- **Categorising.** You build your own rules to put descriptions like "ALBERT HEIJN 1234 AMSTERDAM" under a category, and those rules need maintenance.
- **Looking ahead.** Projecting your balance a few weeks out needs your own formulas for recurring payments.
- **Recurring costs.** You find subscriptions by reading through statements.
- **Investments.** Updating prices and returns is manual or needs extra connections.

## What LaVega does differently

According to the description on [lavega.dev](https://www.lavega.dev/en) (accessed 26 October 2026), LaVega does the following:

- **Import or link.** You drag in bank exports, or link your bank or broker read-only. Linking is optional; importing works too.
- **Automatic categories.** Transactions are categorised automatically.
- **One view.** Accounts at any bank and investments sit together in one overview. For investments you can link Trading 212 and Interactive Brokers read-only.
- **Forecast.** LaVega projects your cash position forward and gives a heads-up when your buffer gets tight.
- **Subscriptions and savings rates.** It finds subscriptions in your transactions and compares savings rates.
- **Read-only.** LaVega has no function to make payments or place orders.

## Privacy and data

With a spreadsheet, everything sits on your own computer or in your own cloud. LaVega describes its model like this: your transactions are encrypted in your browser; your investment data is encrypted on LaVega's server, separated per account; your bank connection runs through the server, but transactions are not stored there, except in an encrypted backup if you store one on the server. LaVega keeps the keys, so technically it can access the data. That is a different model from a local file, and which one you are comfortable with is a personal call. You can delete your server-side data yourself with the "delete server data" button.

## Side by side

| | Spreadsheet | LaVega |
| --- | --- | --- |
| Layout | Fully free | Fixed sections |
| Cost | Nothing extra if you already have the program | LaVega is in beta; no price has been published yet |
| Input | Import or type yourself | Import or read-only link |
| Categorising | Build your own rules | Automatic |
| Looking ahead | Your own formulas | Forecast built in |
| Data storage | Your file | Encrypted, see above |

## Which fits you?

That is your call and depends on your situation. A spreadsheet suits someone who likes building their own and has few accounts. A tool that imports and categorises suits someone who would rather not do the upkeep. You can also combine them: a home-made sheet for one unusual item, next to an overview of the rest.

More to read: [What is a personal CFO?](/en/questions/what-is-a-personal-cfo), [How to clean up your subscriptions](/en/guides/clean-up-your-subscriptions) and [LaVega vs bunq's budgeting features](/en/vs/lavega-vs-budgeting-apps).
