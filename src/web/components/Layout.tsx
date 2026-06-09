import { FC, ReactNode } from 'react';
import Link from 'next/link';

interface LayoutProps {
  children: ReactNode;
}

const Layout: FC<LayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <header className="bg-white border-b border-amber-200 sticky top-0 z-50 shadow-sm">
        <nav className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          {/* Logo */}
          <Link href="/">
            <a className="flex items-center gap-2 text-2xl font-bold text-amber-900 hover:text-amber-700 transition">
              <span className="text-3xl">🌶️</span>
              <span>Trevean Spice</span>
            </a>
          </Link>

          {/* Nav Links */}
          <div className="hidden md:flex items-center gap-8">
            <Link href="/">
              <a className="text-amber-800 hover:text-amber-900 font-medium transition">
                Home
              </a>
            </Link>
            <a
              href="#blends"
              className="text-amber-800 hover:text-amber-900 font-medium transition"
            >
              Blends
            </a>
            <a
              href="#"
              className="text-amber-800 hover:text-amber-900 font-medium transition"
            >
              About
            </a>
            <a
              href="#"
              className="text-amber-800 hover:text-amber-900 font-medium transition"
            >
              Contact
            </a>
          </div>

          {/* Mobile Menu Toggle */}
          <button className="md:hidden text-amber-900 text-2xl">☰</button>
        </nav>
      </header>

      {/* Main Content */}
      <main className="flex-grow">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-amber-900 text-amber-50 mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            {/* Brand */}
            <div>
              <h3 className="text-2xl font-bold mb-4 flex items-center gap-2">
                <span className="text-3xl">🌶️</span>
                Trevean
              </h3>
              <p className="text-amber-100 text-sm">
                Traceable, fresh, and sustainably sourced spice blends from around the world.
              </p>
            </div>

            {/* Company Links */}
            <div>
              <h4 className="font-bold mb-4 text-amber-50">Company</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#" className="text-amber-100 hover:text-amber-50 transition">
                    About Us
                  </a>
                </li>
                <li>
                  <a href="#" className="text-amber-100 hover:text-amber-50 transition">
                    Our Story
                  </a>
                </li>
                <li>
                  <a href="#" className="text-amber-100 hover:text-amber-50 transition">
                    Sustainability
                  </a>
                </li>
                <li>
                  <a href="#" className="text-amber-100 hover:text-amber-50 transition">
                    Blog
                  </a>
                </li>
              </ul>
            </div>

            {/* Product Links */}
            <div>
              <h4 className="font-bold mb-4 text-amber-50">Products</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="/" className="text-amber-100 hover:text-amber-50 transition">
                    Shop Blends
                  </a>
                </li>
                <li>
                  <a href="#" className="text-amber-100 hover:text-amber-50 transition">
                    Recipes
                  </a>
                </li>
                <li>
                  <a href="#" className="text-amber-100 hover:text-amber-50 transition">
                    Gift Sets
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="font-bold mb-4 text-amber-50">Legal</h4>
              <ul className="space-y-2 text-sm">
                <li>
                  <a href="#" className="text-amber-100 hover:text-amber-50 transition">
                    Privacy Policy
                  </a>
                </li>
                <li>
                  <a href="#" className="text-amber-100 hover:text-amber-50 transition">
                    Terms of Service
                  </a>
                </li>
                <li>
                  <a href="#" className="text-amber-100 hover:text-amber-50 transition">
                    Cookie Policy
                  </a>
                </li>
              </ul>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-amber-800 pt-8">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <p className="text-amber-100 text-sm">
                Copyright © 2026 Trevean Spice. All rights reserved.
              </p>
              <div className="flex gap-4">
                <a
                  href="#"
                  className="text-amber-100 hover:text-amber-50 transition"
                  title="Facebook"
                >
                  f
                </a>
                <a
                  href="#"
                  className="text-amber-100 hover:text-amber-50 transition"
                  title="Instagram"
                >
                  📷
                </a>
                <a
                  href="#"
                  className="text-amber-100 hover:text-amber-50 transition"
                  title="Twitter"
                >
                  𝕏
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
