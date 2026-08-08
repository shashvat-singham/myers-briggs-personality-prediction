import { ButtonLink, Card } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-5 py-28">
      <Card className="p-10 text-center">
        <p className="font-mono text-5xl font-semibold text-gradient">404</p>
        <p className="mt-4 text-mute">There&apos;s nothing at this address.</p>
        <div className="mt-8 flex justify-center gap-3">
          <ButtonLink href="/">Home</ButtonLink>
          <ButtonLink href="/types" variant="outline">
            The sixteen
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}
