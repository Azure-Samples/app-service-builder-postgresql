# Contributing

This project welcomes contributions and suggestions. Most contributions require
you to agree to a Contributor License Agreement (CLA) declaring that you have
the right to grant the rights to use your contribution. See
https://cla.opensource.microsoft.com.

When you submit a pull request, a CLA bot will determine whether you need to
provide a CLA and decorate the pull request appropriately. Follow the bot's
instructions. You only need to do this once across Microsoft repositories.

This project follows the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
See the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/)
or contact opencode@microsoft.com with additional questions or comments.

Before submitting changes, run `npm ci`, `npm test`, and `npm run build`.
Database integration tests require an explicitly confirmed dedicated seeded
test database. Never use a production database or commit tokens, passwords,
environment files, customer data, or resource-specific credentials.
