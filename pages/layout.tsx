import { Authenticate, currentUser } from '@aha-app/builder-core';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <Authenticate>
      {children}
    </Authenticate>
  );
}
