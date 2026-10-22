// Fake Cypress spec — executed in the cypress/included container by Argo.
describe('checkout', () => {
  it('adds an item to the cart', () => {
    cy.visit(Cypress.env('BASE_URL') ?? 'https://example.com');
    cy.contains('Example Domain');
  });
});
