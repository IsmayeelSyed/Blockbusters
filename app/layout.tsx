import "./globals.css";

export const metadata = {
  title: "Blockbusters — Online",
  description: "Two-player Blockbusters board with Supabase Realtime",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
