import { LoginCard } from "./LoginCard";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <LoginCard />
    </div>
  );
}
