import { Screen, Wordmark } from "@/components/ui";

export default function OfflinePage() {
  return (
    <Screen className="justify-center">
      <Wordmark className="mb-6" />
      <p className="caption">You&rsquo;re offline. Logging needs a connection.</p>
    </Screen>
  );
}
