import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Route, Switch, useLocation, useSearch } from "wouter";
import {
  Alert,
  Anchor,
  Button,
  Loader,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { CreateTeamModal } from "@/components/account/create-team-modal";
import { ACCOUNT_SESSION_CHANGED } from "@/application/account/account-session";
import {
  accountTeams,
  readChosenOrganization,
  rememberChosenOrganization,
} from "@/core/account/account-teams";
import {
  CHECKOUT_FAILED_MEMBERS_PATH,
  useCreateTeam,
} from "@/hooks/use-create-team";
import { createOrganizationHttpClient } from "@/infrastructure/account/organizations";
import { useAccountSession } from "@/hooks/use-account-session";
import { useBrowserOnline } from "@/hooks/use-browser-online";
import { createBrowserSession } from "@/infrastructure/account/browser-session";
import { getAccountApiOrigin } from "@/infrastructure/account/api-origin";
import { createProjectServiceHttpClient } from "@/infrastructure/project-sync/project-service-http-client";
import type { RemoteProject } from "@/contracts/project-sync/project-service";
import type { ProjectManifest } from "@/contracts/modeling/project-manifest";
import { createDashboardLocalProjects } from "@/infrastructure/persistence/dashboard-local-projects";
import { createProjectAccessHttpClient } from "@/infrastructure/account/project-access";
import { useShareDialog } from "@/components/account/sharing/use-share-dialog";
import { DashboardProjectPage } from "./project/dashboard-project-page";
import { rememberPage } from "@/core/navigation/last-page";
import { DashboardSidebar } from "./dashboard-sidebar";
import { DashboardMembersPage } from "./members/dashboard-members-page";
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
  const [location, navigate] = useLocation();
  const search = useSearch();
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
  const accessPort = useMemo(
    () => createProjectAccessHttpClient({ apiOrigin: getAccountApiOrigin() }),
    [],
  );
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
  const teams = accountTeams(account);
  // Choices and lists belong to the account that made them: after an account
  // change nothing of the previous account shows while the new one loads.
  const [chosenOrganization, setChosenOrganization] = useState<{
    userId: string;
    organizationId: string;
  } | null>(null);
  const chosenId = !userId
    ? null
    : chosenOrganization?.userId === userId
      ? chosenOrganization.organizationId
      : readChosenOrganization(window.localStorage, userId);
  const chooseOrganization = (organizationId: string) => {
    if (!userId) return;
    rememberChosenOrganization(window.localStorage, userId, organizationId);
    setChosenOrganization({ userId, organizationId });
  };
  const chosen = owners.find((org) => org.organizationId === chosenId);
  // Members is a team page: it shows the chosen team, else the first one.
  const selected =
    location === "/dashboard/members" &&
    !teams.some((team) => team.id === chosen?.organizationId)
      ? (owners.find((org) =>
          teams.some((team) => team.id === org.organizationId),
        ) ?? chosen)
      : (chosen ?? owners[0]);
  const selectedTeam = teams.find(
    (team) => team.id === selected?.organizationId,
  );
  const organizationPort = useMemo(
    () => createOrganizationHttpClient({ apiOrigin: getAccountApiOrigin() }),
    [],
  );
  const createTeam = useCreateTeam(
    organizationPort,
    (organization, checkout) => {
      chooseOrganization(organization.id);
      if (checkout) return window.location.assign(checkout);
      // Every open page learns about the new team.
      window.localStorage.setItem(ACCOUNT_SESSION_CHANGED, String(Date.now()));
      session.onOpen();
      navigate(CHECKOUT_FAILED_MEMBERS_PATH);
    },
  );
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
  // Bumped when a project is deleted, to list the projects again.
  const [projectsRevision, setProjectsRevision] = useState(0);
  // Leaving reloads the account, which lists the projects again.
  const { openShareDialog, shareDialog } = useShareDialog({
    port: accessPort,
    account,
  });
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
  }, [account, online, projectsRevision]);

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
                manageHref: `/dashboard/p/${encodeURIComponent(project.id)}${query}`,
                onShare: () =>
                  openShareDialog({
                    orgId: project.organization_id,
                    projectId: project.id,
                    name: project.name,
                  }),
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
                detail:
                  project.owner_name ??
                  organizationName(project.organization_id),
                href: `/app/p/${encodeURIComponent(project.id)}${query}`,
                manageHref: `/dashboard/p/${encodeURIComponent(project.id)}${query}`,
                onShare: () =>
                  openShareDialog({
                    orgId: project.organization_id,
                    projectId: project.id,
                    name: project.name,
                  }),
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
  // Without a team there is no Members page to speak of.
  const notFound = (
    <Stack align="flex-start">
      <Title order={1} size={20}>
        Page not found
      </Title>
      <Anchor component={Link} href="/dashboard">
        Back to projects
      </Anchor>
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
        selectedIsTeam={selectedTeam !== undefined}
        onSelectOrganization={(organizationId) => {
          chooseOrganization(organizationId);
          // A workspace without members leaves the Members page for its projects.
          if (
            location === "/dashboard/members" &&
            !teams.some((team) => team.id === organizationId)
          )
            navigate("/dashboard");
        }}
        onSignIn={signIn}
        onCreateTeam={() => {
          setAccountMenuOpened(false);
          createTeam.open();
        }}
        onOpenTeam={(organizationId) => {
          setAccountMenuOpened(false);
          chooseOrganization(organizationId);
          navigate("/dashboard/members");
        }}
      />
      {account && <CreateTeamModal {...createTeam} />}
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
          <Route path="/dashboard/members">
            {account && selectedTeam ? (
              <DashboardMembersPage
                key={selectedTeam.id}
                port={organizationPort}
                organizationId={selectedTeam.id}
                userId={account.user.id}
                role={selectedTeam.role}
                checkoutFailed={
                  new URLSearchParams(search).get("checkout") === "failed"
                }
              />
            ) : session.busy || !session.accountChecked ? (
              <Loader size="sm" aria-label="Loading account" />
            ) : !account ? (
              placeholder("Members")
            ) : (
              notFound
            )}
          </Route>
          <Route path="/dashboard/plan">{placeholder("Usage & plan")}</Route>
          <Route path="/dashboard/settings">{placeholder("Settings")}</Route>
          <Route path="/dashboard/p/:projectId">
            {(params) => (
              <DashboardProjectPage
                projectId={params.projectId}
                account={account}
                accountChecked={session.accountChecked}
                projects={remote}
                port={accessPort}
                onSignIn={signIn}
                onDeleted={() => {
                  setProjectsRevision((revision) => revision + 1);
                  navigate("/dashboard");
                }}
                onLeft={() => navigate("/dashboard")}
                onChangePlan={() => navigate("/dashboard/plan")}
              />
            )}
          </Route>
          <Route>{notFound}</Route>
        </Switch>
      </main>
      {shareDialog}
    </div>
  );
}
