import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function Unauthorized() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-2xl font-semibold">Unauthorized</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        You do not have permission to view this page.
      </p>
      <Button asChild>
        <Link to="/">Go to Dashboard</Link>
      </Button>
    </div>
  );
}
