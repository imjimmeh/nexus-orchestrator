import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

export interface AsyncButtonProps extends ButtonProps {
  isLoading: boolean;
  loadingIcon?: React.ReactNode;
}

const AsyncButton = React.forwardRef<HTMLButtonElement, AsyncButtonProps>(
  ({ isLoading, loadingIcon, children, disabled, ...props }, ref) => (
    <Button ref={ref} disabled={isLoading || disabled} {...props}>
      {isLoading && (loadingIcon ?? <Loader2 className="animate-spin" />)}
      {children}
    </Button>
  ),
);
AsyncButton.displayName = "AsyncButton";

export { AsyncButton };
