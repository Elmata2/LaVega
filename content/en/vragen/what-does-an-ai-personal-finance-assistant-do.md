---
id: ai-finance-assistant
family: vragen
title: "What does an AI personal finance assistant do?"
description: "What an AI personal finance assistant does with your money data, where its limits are and which privacy questions to ask of any tool."
status: draft
author: alexander
updated: 2026-10-26
sources:
  - { title: "LaVega: product page and frequently asked questions", url: "https://www.lavega.dev/en", accessed: 2026-10-26 }
faq:
  - { q: "Can an AI finance assistant manage my money?", a: "No. An assistant reads and explains. Paying, transferring or placing orders needs a separate connection with write access, and a read-only connection does not have it." }
  - { q: "Are the numbers from an AI assistant reliable?", a: "That depends on where they come from. Numbers produced by ordinary, checkable code can be traced. A language model that does its own arithmetic can make mistakes." }
  - { q: "Which privacy question do I always ask?", a: "Which data goes to the AI provider, is it stored or used for training, and who holds the keys to the storage?" }
---

## What is an AI personal finance assistant?

An AI personal finance assistant is software that uses language models to help with your money. You ask a question in plain words, such as "why did I spend more last month?", and get an answer in plain words. Other assistants work in the background: they sort transactions into categories, read an invoice or summarise an overview.

Those are two different things that often share one name. One is a conversation about your numbers. The other is automation that takes a task off your hands.

## What does AI do well?

- **Understanding text.** A bank line like "AH 1234 AMSTERDAM" or "Betaalverzoek Jan" is messy. A language model can guess which category it belongs to. This is useful if you read Dutch bank statements as a non-native speaker.
- **Explaining.** A term like "heffingsvrij vermogen" (the tax-free allowance in box 3) can be explained in plain English.
- **Summarising.** A long list of transactions becomes a short description of what changed.
- **Reading documents.** Turning a PDF invoice into fields such as amount, date and supplier.

## Where are the limits?

**AI can be wrong.** Language models produce plausible text. That does not mean the text is correct. A model can pick the wrong category or invent a rule that does not exist.

**AI is not a source for tax rules or rates.** A figure a model quotes from memory may be out of date. Always ask for the source and check it yourself, for example at the Dutch tax authority.

**AI does not know your situation.** It only sees what you show it.

**AI does not replace an adviser.** Which financial product fits you is a question for an adviser with an AFM licence.

## Who actually does the arithmetic?

This is the most useful question to ask of any tool: do the numbers come from a language model, or from ordinary code?

Money needs arithmetic that gives the same answer every time. Adding up a balance, projecting a forecast or comparing a rate gives the same result for the same input. That fits fixed code you can check. A language model belongs to the part that is language: understanding what you ask and explaining the answer.

The split looks like this:

- **Code calculates.** Adding, forecasting, comparing.
- **AI explains and reads.** Sorting text, answering questions, reading documents.
- **You confirm.** A good assistant puts a proposal in front of you instead of applying it quietly.

## Privacy questions for any tool

An assistant needs data. Ask these questions before you share it:

1. **Which data goes to the AI provider?** Everything, or only a stripped-down part?
2. **Is it stored or used to train models?** And for how long?
3. **Who holds the keys?** If the provider holds them, it can technically reach your data. That is acceptable when said openly, but it is good to know.
4. **Is AI required or optional?** Can you use the tool without anything going to an AI provider?
5. **Can you delete your data?** And what exactly disappears?
6. **Is the bank connection read-only?** If so, the tool cannot pay anything.

For people living in the Netherlands: data protection here falls under the GDPR. Ask where the provider is based and where the data is stored.

## How does LaVega fit?

LaVega calculates with ordinary code. The overview, the forecast, the subscriptions and the rate comparison do not come from a language model. You only use LaVega's AI features when you switch them on or start them. For categorising and invoice reading you confirm before anything is saved.

On the questions above:

- The bank and broker connections are read-only. LaVega has no function to make payments or place orders.
- Your transactions are stored encrypted in your browser. LaVega holds the keys, so technically LaVega can reach the data.
- You can delete your server-side data yourself in the app. The sign-in account itself cannot yet be deleted in the app; we delete it on request.
- LaVega provides information and explanation. It is not financial advice, and LaVega has no AFM licence.

## What you do with it

Use an AI assistant as a tool for understanding your numbers, and check what matters to you. Compare a figure with your own bank statement. Look up a tax amount at the source. See also [What is a personal CFO?](/en/questions/what-is-a-personal-cfo) for the question of which work software can take over.

This is information, not advice.
