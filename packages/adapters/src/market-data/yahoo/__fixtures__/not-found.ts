export const notFoundYahooFixture = {
  status: 404,
  body: JSON.stringify({
    chart: {
      result: null,
      error: { code: "Not Found", description: "No data found, symbol may be delisted" },
    },
  }),
} as const;
