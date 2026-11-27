import { createBrowserRouter, RouterProvider } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { Landing } from './pages/Landing.tsx';
import { Intake } from './pages/Intake.tsx';
import { Run } from './pages/Run.tsx';
import { Kpo } from './pages/Kpo.tsx';
import { Evidence } from './pages/Evidence.tsx';
import { About } from './pages/About.tsx';
import { Docs } from './pages/Docs.tsx';
import { Agents } from './pages/Agents.tsx';
import { Proof } from './pages/Proof.tsx';
import { NotFound } from './pages/NotFound.tsx';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Landing /> },
      { path: '/check', element: <Intake /> },
      { path: '/runs/:runId', element: <Run /> },
      { path: '/runs/:runId/kpo', element: <Kpo /> },
      { path: '/evidence', element: <Evidence /> },
      { path: '/about', element: <About /> },
      { path: '/docs', element: <Docs /> },
      { path: '/agents', element: <Agents /> },
      { path: '/proof', element: <Proof /> },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
