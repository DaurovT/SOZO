import { BrowserRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Apply from './pages/Apply';
import Business from './pages/Business';
import Calculator from './pages/Calculator';
import Home from './pages/Home';
import Legal from './pages/Legal';
import Masters from './pages/Masters';
import NotFound from './pages/NotFound';
import Order from './pages/Order';
import Verify from './pages/Verify';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} /> {/* L-01 */}
          <Route path="/order" element={<Order />} /> {/* L-02 */}
          <Route path="/business" element={<Business />} /> {/* L-03 */}
          <Route path="/calculator" element={<Calculator />} /> {/* L-04 */}
          <Route path="/masters" element={<Masters />} /> {/* L-05 */}
          <Route path="/apply" element={<Apply />} /> {/* L-06 */}
          <Route path="/m/:code" element={<Verify />} /> {/* L-07 — noindex */}
          <Route path="/legal" element={<Legal />} /> {/* L-08 */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
