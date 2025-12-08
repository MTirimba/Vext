'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthState } from 'react-firebase-hooks/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import AuthModal from './AuthModal';

interface NavbarProps {
  onAuthClick?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onAuthClick }) => {
  const [user] = useAuthState(auth);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [isProvider, setIsProvider] = useState(false);
  const [username, setUsername] = useState('');
  const router = useRouter();

  useEffect(() => {
    if (!user) return;

    getDoc(doc(db, 'users', user.uid)).then((snap) => {
      const data = snap.data();
      if (data) {
        setIsProvider(!!data.isProvider);
        setUsername(data.username || '');
      }
    });
  }, [user]);

  const handleSignOut = async () => {
    await auth.signOut();
    router.push('/');
  };

  const handleBookingsClick = () => {
    router.push(isProvider ? '/creator/bookings' : '/bookings');
  };

  return (
    <>
      {/* Transparent gradient navbar overlay */}
      <div className="absolute top-0 left-0 w-full z-50 bg-gradient-to-b from-black/40 to-transparent p-4 flex justify-end">
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="focus:outline-none"
          >
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt="profile"
                className="w-8 h-8 rounded-full object-cover border border-white/40"
              />
            ) : (
              <div className="w-8 h-8 bg-gray-400 rounded-full flex items-center justify-center">
                <span className="text-white font-medium">U</span>
              </div>
            )}
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-gray-900 rounded-lg shadow-lg p-3 text-white">
              {user ? (
                <>
                  <div className="flex items-center space-x-3 p-2 mb-3 bg-gray-800 rounded">
                    {user.photoURL ? (
                      <img
                        src={user.photoURL}
                        alt="Avatar"
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-gray-600 rounded-full flex items-center justify-center">
                        <span className="text-white">U</span>
                      </div>
                    )}
                    <span className="font-semibold truncate">@{username}</span>
                  </div>

                  {isProvider && (
                    <>
                      <button
                        onClick={() => router.push('/upload')}
                        className="block w-full px-3 py-2 hover:bg-gray-700 rounded mb-1"
                      >
                        Upload
                      </button>

                      <button
                        onClick={() => router.push('/provider/dashboard')}
                        className="block w-full px-3 py-2 hover:bg-gray-700 rounded mb-1"
                      >
                        Provider Dashboard
                      </button>
                    </>
                  )}

                  <button
                    onClick={handleBookingsClick}
                    className="block w-full px-3 py-2 hover:bg-gray-700 rounded mb-1"
                  >
                    {isProvider ? 'Client Bookings' : 'My Bookings'}
                  </button>

                  <button
                    onClick={() => router.push('/profile')}
                    className="block w-full px-3 py-2 hover:bg-gray-700 rounded mb-1"
                  >
                    Edit Profile
                  </button>

                  <button
                    onClick={handleSignOut}
                    className="block w-full px-3 py-2 hover:bg-gray-700 rounded text-red-400"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <button
                  onClick={() => {
                    setAuthDialogOpen(true);
                    if (onAuthClick) onAuthClick();
                  }}
                  className="block w-full px-3 py-2 hover:bg-gray-700 rounded"
                >
                  Sign In / Sign Up
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <AuthModal open={authDialogOpen} onClose={() => setAuthDialogOpen(false)} />
    </>
  );
};