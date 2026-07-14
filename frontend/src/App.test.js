import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

test('renders login page title', () => {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <App />
    </MemoryRouter>
  );
  const titleElement = screen.getByText(/Finance Manager/i);
  expect(titleElement).toBeInTheDocument();
});

