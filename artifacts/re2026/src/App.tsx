import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Landing from "@/pages/landing";

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(200, 60%, 25%)",
    colorForeground: "hsl(210, 40%, 15%)",
    colorMutedForeground: "hsl(210, 15%, 45%)",
    colorDanger: "hsl(0, 84%, 60%)",
    colorBackground: "hsl(210, 20%, 98%)",
    colorInput: "hsl(210, 20%, 86%)",
    colorInputForeground: "hsl(210, 40%, 15%)",
    colorNeutral: "hsl(210, 20%, 86%)",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.3rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-xl w-[440px] max-w-full overflow-hidden shadow-md border border-[hsl(210,20%,86%)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[hsl(210,40%,15%)] font-bold",
    headerSubtitle: "text-[hsl(210,15%,45%)]",
    socialButtonsBlockButtonText: "text-[hsl(210,40%,15%)]",
    formFieldLabel: "text-[hsl(210,40%,15%)] font-medium",
    footerActionLink: "text-[hsl(200,60%,25%)] font-semibold",
    footerActionText: "text-[hsl(210,15%,45%)]",
    dividerText: "text-[hsl(210,15%,45%)]",
    identityPreviewEditButton: "text-[hsl(200,60%,25%)]",
    formFieldSuccessText: "text-green-600",
    alertText: "text-[hsl(210,40%,15%)]",
    logoBox: "flex justify-center",
    logoImage: "h-10 w-10 rounded-lg",
    socialButtonsBlockButton: "border border-[hsl(210,20%,86%)] hover:bg-[hsl(210,20%,95%)]",
    formButtonPrimary: "bg-[hsl(200,60%,25%)] hover:opacity-90",
    formFieldInput: "border-[hsl(210,20%,86%)] bg-white text-[hsl(210,40%,15%)]",
    footerAction: "bg-[hsl(210,20%,96%)]",
    dividerLine: "bg-[hsl(210,20%,86%)]",
    alert: "border border-[hsl(0,84%,60%,0.3)] bg-[hsl(0,84%,97%)]",
    otpCodeFieldInput: "border-[hsl(210,20%,86%)] bg-white",
    formFieldRow: "",
    main: "",
  },
};

const clerkLocalization = {
  signIn: {
    start: {
      title: "Willkommen zurück",
      subtitle: "Melden Sie sich bei RE2026 an",
      actionText: "Noch kein Konto?",
      actionLink: "Registrieren",
    },
  },
  signUp: {
    start: {
      title: "Konto erstellen",
      subtitle: "Registrieren Sie sich für RE2026",
      actionText: "Bereits ein Konto?",
      actionLink: "Anmelden",
    },
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={`${basePath}/app`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/app`}
      />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to={`/app${window.location.search}`} />
      </Show>
      <Show when="signed-out">
        <Landing />
      </Show>
    </>
  );
}

function AppRoute() {
  return (
    <>
      <Show when="signed-in">
        <Home />
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      localization={clerkLocalization}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator />
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="/app" component={AppRoute} />
            <Route component={NotFound} />
          </Switch>
          <Toaster />
          <SonnerToaster richColors />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
