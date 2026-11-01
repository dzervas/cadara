import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Switch, useLocation } from "wouter";
import { Alert, Anchor, Button, Stack, Text, Title } from "@mantine/core";
import { useAccountSession } from "@/hooks/use-account-session";
import { useBrowserOnline } from "@/hooks/use-browser-online";
import { createBrowserSession } from "@/infrastructure/account/browser-session";
import { getAccountApiOrigin } from "@/infrastructure/account/api-origin";
import { createProjectServiceHttpClient } from "@/infrastructure/project-sync/project-service-http-client";
import type { RemoteProject } from "@/contracts/project-sync/project-service";
import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
import { createDashboardLocalProjects } from "@/infrastructure/persistence/dashboard-local-projects";
import { rememberPage } from "@/core/navigation/last-page";
import { DashboardSidebar } from "./dashboard-sidebar";
import {
  DashboardProjectsPage,
  type DashboardProjectSection,
} from "./dashboard-projects-page";
import "./dashboard.css";

const documentCount = (count: number) =>
  `${count} ${count === 1 ? "document" : "documents"}`;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export function DashboardApp() {
  const [location] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const notifyError = useCallback((message: string) => setError(message), []);
  const port = useMemo(
    () =>
      createBrowserSession({
        apiOrigin: getAccountApiOrigin(),
        callbackURL: new URL("/dashboard", window.location.origin).href,
      }),
    [],
  );
  const session = useAccountSession(port, notifyError);
  const [accountMenuOpened, setAccountMenuOpened] = useState(false);
  const signIn = () => {
    setAccountMenuOpened(true);
    session.onOpen();
  };
  const online = useBrowserOnline();
  useEffect(() => {
    rememberPage(window.localStorage, location);
  }, [location]);

  const account = session.account;
  const userId = account?.user.id ?? null;
  const owners = account?.me.organizations ?? [];
  // Choices and lists belong to the account that made them: after an account
  // change nothing of the previous account shows while the new one loads.
  const [chosenOrganization, setChosenOrganization] = useState<{
    userId: string;
    organizationId: string;
  } | null>(null);
  const selected =
    owners.find(
      (org) =>
        chosenOrganization?.userId === userId &&
        org.organizationId === chosenOrganization.organizationId,
    ) ?? owners[0];
  const organizationName = (organizationId: string) =>
    account?.organizations.find((org) => org.id === organizationId)?.name ??
    "Your workspace";

  const [local, setLocal] = useState<ProjectManifest[] | null>(null);
  useEffect(() => {
    let live = true;
    void createDashboardLocalProjects(
      window.localStorage,
      window.location.search,
    )
      .list()
      .then((result) => {
        if (!live) return;
        if (result.ok)
          setLocal(result.value.filter((project) => !project.service));
        else setError(result.diagnostic.message);
      })
      .catch((error: unknown) => {
        if (live) setError(errorMessage(error));
      });
    return () => {
      live = false;
    };
  }, []);

  const [remoteState, setRemoteState] = useState<{
    userId: string;
    projects: RemoteProject[];
  } | null>(null);
  const remote =
    remoteState && remoteState.userId === userId ? remoteState.projects : null;
  useEffect(() => {
    if (!account || !online) return;
    let live = true;
    const service = createProjectServiceHttpClient({
      apiOrigin: getAccountApiOrigin(),
    });
    void Promise.allSettled(
      account.organizations.map((org) => service.listProjects(org.id)),
    ).then((lists) => {
      if (!live) return;
      setRemoteState({
        userId: account.user.id,
        projects: lists.flatMap((list) =>
          list.status === "fulfilled" ? list.value : [],
        ),
      });
      // One organization's failure leaves the others' projects listed.
      const failure = lists.find((list) => list.status === "rejected");
      if (failure)
        setError(
          `Some account projects could not be loaded: ${errorMessage(failure.reason)}`,
        );
    });
    return () => {
      live = false;
    };
  }, [account, online]);

  const query = window.location.search;
  const sections: DashboardProjectSection[] = [
    {
      id: "local",
      title: "On this device",
      detail: "stays in this browser, no quota",
      projects: (local ?? []).map((project) => ({
        id: project.projectId,
        name: project.name,
        detail: documentCount(
          project.entries.filter((entry) => entry.kind !== "discussion").length,
        ),
        href: `/app/local/${encodeURIComponent(project.projectId)}${query}`,
      })),
    },
    ...(account && selected
      ? [
          {
            id: selected.organizationId,
            title: organizationName(selected.organizationId),
            projects: (remote ?? [])
              .filter(
                (project) =>
                  project.organization_id === selected.organizationId,
              )
              .map((project) => ({
                id: project.id,
                name: project.name,
                detail: project.visibility === "public" ? "Public" : "Private",
                href: `/app/p/${encodeURIComponent(project.id)}${query}`,
              })),
          },
        ]
      : []),
    ...(account && remote
      ? [
          {
            id: "shared",
            title: "Shared with me",
            projects: remote
              .filter(
                (project) =>
                  !owners.some(
                    (org) => org.organizationId === project.organization_id,
                  ),
              )
              .map((project) => ({
                id: project.id,
                name: project.name,
                detail: organizationName(project.organization_id),
                href: `/app/p/${encodeURIComponent(project.id)}${query}`,
              })),
          },
        ]
      : []),
  ];

  if (!online)
    return (
      <Stack p="xl" align="flex-start">
        <Title order={1} size="h3">
          You're offline
        </Title>
        <Text>Open the editor to work on projects on this device.</Text>
        <Button component="a" href="/app" variant="default">
          Open editor
        </Button>
      </Stack>
    );
  const placeholder = (title: string) => (
    <Stack align="flex-start">
      <Title order={1} size={20}>
        {title}
      </Title>
      <Text c="dimmed">
        {account
          ? "This page is not available yet."
          : "Sign in to access this page."}
      </Text>
      {!account && <Button onClick={signIn}>Sign in</Button>}
    </Stack>
  );
  return (
    <div className="dashboard-shell">
      <DashboardSidebar
        location={location}
        session={session}
        accountMenuOpened={accountMenuOpened}
        onAccountMenuOpenedChange={setAccountMenuOpened}
        owners={owners}
        selected={selected}
        organizationName={organizationName}
        onSelectOrganization={(organizationId) =>
          userId && setChosenOrganization({ userId, organizationId })
        }
        onSignIn={signIn}
      />
      <main className="dashboard-main">
        {error && (
          <Alert
            color="red"
            mb="md"
            role="alert"
            withCloseButton
            onClose={() => setError(null)}
          >
            {error}
          </Alert>
        )}
        <Switch>
          <Route path="/dashboard">
            <DashboardProjectsPage
              sections={sections}
              loading={!local && !error}
              signedIn={account !== null}
              onSignIn={signIn}
            />
          </Route>
          <Route path="/dashboard/members">{placeholder("Members")}</Route>
          <Route path="/dashboard/plan">{placeholder("Usage & plan")}</Route>
          <Route path="/dashboard/settings">{placeholder("Settings")}</Route>
          <Route path="/dashboard/p/:projectId">
            {(params) => (
              <Stack align="flex-start">
                <Title order={1} size={20}>
                  Project
                </Title>
                <Text>Open this project in the editor to manage it.</Text>
                <Anchor href={`/app/p/${params.projectId}`}>
                  Open in editor
                </Anchor>
              </Stack>
            )}
          </Route>
          <Route>
            <Stack align="flex-start">
              <Title order={1} size={20}>
                Page not found
              </Title>
              <Anchor component={Link} href="/dashboard">
                Back to projects
              </Anchor>
            </Stack>
          </Route>
        </Switch>
      </main>
    </div>
  );
}
