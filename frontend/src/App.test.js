import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import BorrowPortal from './BorrowPortal';

test('renders login page title', () => {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <App />
    </MemoryRouter>
  );
  const titleElement = screen.getByText(/Finance Manager/i);
  expect(titleElement).toBeInTheDocument();
});

test('renders borrow portal summary labels', async () => {
  const mockApi = {
    get: jest.fn().mockResolvedValue({ data: { data: [] } }),
    post: jest.fn().mockResolvedValue({ data: { data: {} } }),
    put: jest.fn().mockResolvedValue({ data: { data: {} } }),
    delete: jest.fn().mockResolvedValue({ data: { data: {} } }),
  };

  const MockPortalLayout = ({ children }) => <div>{children}</div>;

  await act(async () => {
    render(
      <MemoryRouter>
        <BorrowPortal
          api={mockApi}
          PortalLayout={MockPortalLayout}
          userMobile="9876543210"
          onLogout={() => {}}
        />
      </MemoryRouter>
    );
  });

  expect(screen.getByText(/Total Borrowed/i)).toBeInTheDocument();
  expect(screen.getByText(/Total Outstanding/i)).toBeInTheDocument();
  expect(screen.getByText(/Total Paid/i)).toBeInTheDocument();
  expect(screen.getByText(/Overdue Loans/i)).toBeInTheDocument();
});
