# Web screens

## Navigation: the `?view=` query string

There is no router. `useAppShell()` in `App.tsx` reads the open view from the query string through `viewFromSearch()`, turns it into a `Screen` with `screenFor()`, and `App` renders that screen inside `AppView`. Opening another view calls `openedUrl()` and `history.replaceState`.

```mermaid
flowchart TD
  main["main.tsx<br/>QueryClientProvider"] --> App["App.tsx: App()"]
  App --> shell["useAppShell()"]
  shell -->|"location.search"| vfs["app-shell.ts: viewFromSearch()"]
  shell -->|"supabase.auth.getSession()"| sess["session"]
  vfs --> sf["app-shell.ts: screenFor()"]
  sess --> sf
  shell -->|"onOpen()"| ou["app-shell.ts: openedUrl()<br/>sets ?view= and ?recipe=,<br/>drops ?service= and ?day="]
  App --> AV["AppView.tsx: AppView<br/>header, NAV, renderScreen(screen)"]
  sf --> AV

  sf -->|"session undefined"| checking["checking: renders null"]
  sf -->|"session null"| signIn["signIn: SignIn.tsx"]
  sf -->|"no ?view= / unknown"| menu["menu: MenuScreen<br/>reads ?menu="]
  sf -->|"?view=catalog"| catalog["catalog: CatalogScreen"]
  sf -->|"?view=availability"| avail["availability: AvailabilityScreen"]
  sf -->|"?view=recipes"| recipes["recipes: RecipesScreen<br/>onOpen opens recipe"]
  sf -->|"?view=recipe&recipe=id"| recipe["recipe: RecipeScreen recipeId"]
  sf -->|"?view=plan&service=id"| plan["plan: PlanScreen serviceId"]
  sf -->|"?view=today&service=id"| today["today: TodayScreen serviceId<br/>reads ?day= via dayFromLink()"]
  sf -->|"?view=shopping&service=id"| shopping["shopping: ShoppingListScreen serviceId"]

  vfs -.->|"?view=recipe without ?recipe="| recipes
  vfs -.->|"plan/today/shopping without ?service="| menu
```

Fallbacks: `viewFromSearch()` turns `?view=recipe` without `?recipe=` into `recipes`, and `plan`, `today` or `shopping` without `?service=` into `menu`. `screenFor()` also falls back to `menu` when the view lacks its id. The `?day=` param is not read by the shell: `today-checklist.ts` reads it (`dayFromLink`) and writes it back (`linkWithDay`, `putShownDayInLink`). The open Menu lives in `?menu=`, read by `menuIdFromUrl()` in `MenuScreen.tsx`. The header's `NAV` offers Menu, Recipes, Catalog and Availability; Plan, Today and Shopping are reached by links carrying `?service=`.

## Core, hook and view (ADR 0011)

```mermaid
flowchart LR
  subgraph today["Today checklist"]
    TS["TodayScreen.tsx: TodayScreen<br/>TodayView {...useTodayChecklist(serviceId)}"]
    TH["hook: useTodayChecklist()<br/>useQuery fetchPlan, useMutation mutate,<br/>useIntent, useQueryClient"]
    TC["core: today-checklist.ts<br/>shownDay, dayFromLink, linkWithDay,<br/>tickKey, tickSave, boxChecked, wasDue"]
    TV["view: TodayView.tsx: TodayView<br/>props: plan, day, ticking, tickError,<br/>onChoose, onTick, onPrint"]
    TS --> TH
    TS --> TV
    TH --> TC
    TV --> TC
  end

  subgraph menu["Menu screen: one hook per part"]
    MS["MenuScreen.tsx: MenuScreen"]
    ML["useMenuList()"] --> MLV["MenuListView"]
    NM["useNewMenu()"] --> NMV["NewMenuView"]
    UM["useMenu()"] --> MV["MenuView<br/>slots: renderCourse, renderServiceForm"]
    UC["useCourse()"] --> CV["CourseView<br/>slot: renderDishScale"]
    UD["useDishScale()"] --> DV["DishScaleView"]
    US["useServiceForm()"] --> SV["ServiceFormView"]
    MS --> ML
    MS --> NM
    MS --> UM
    MV -.->|"renderCourse"| UC
    MV -.->|"renderServiceForm"| US
    CV -.->|"renderDishScale"| UD
    MC["core: menu-screen.ts<br/>dishScaleSave, serviceSave,<br/>parseGuests, serviceInput, menuHref"]
    UD --> MC
    US --> MC
  end

  API["api.ts<br/>fetchPlan, fetchMenu, fetchMenus,<br/>fetchAvailability, mutate"]
  TH --> API
  ML --> API
  NM --> API
  UM --> API
  UC --> API
  UD --> API
  US --> API

  subgraph tests["Tests"]
    T1["*.test.ts in Node<br/>today-checklist.test.ts, menu-screen.test.ts"]
    T2["view tests *.test.tsx in jsdom, plain props<br/>TodayView.test.tsx, MenuViews.test.tsx"]
    T3["hook and wired tests, vi.mock api.ts<br/>web/test/render-view.tsx:<br/>renderQueryHook(), renderWired()<br/>TodayScreen.test.tsx, MenuScreen.test.tsx"]
  end
  T1 -.-> TC
  T1 -.-> MC
  T2 -.-> TV
  T2 -.-> MV
  T3 -.-> TH
  T3 -.-> UM
```

What each layer may call:

- **Core** (`*.ts`, e.g. `today-checklist.ts`, `menu-screen.ts`): pure TypeScript. Decisions, validation, formatting, and each named mutation's name and args (`tickSave`, `dishScaleSave`, `serviceSave` return a `MutationCall`). It imports only types from `api.ts`. Unit-tested in Node.
- **Hook** (`useTodayChecklist`, `useMenuList`, `useNewMenu`, `useMenu`, `useCourse`, `useDishScale`, `useServiceForm`): calls `useQuery`, `useMutation`, `useIntent`, `useQueryClient` and `api.ts`, and passes the core's results through, with no branches of its own. Tested through `renderQueryHook()` (the hook alone) or `renderWired()` (hook plus view), each inside a fresh QueryClient with `retry: false`, with only `./api.ts` faked by `vi.mock` (plus `./supabase.ts` for the app shell and sign-in).
- **View** (`TodayView`, `MenuViews.tsx`): props only, no fetching. A parent view takes nested parts as `render…` slot props (`renderCourse`, `renderServiceForm`, `renderDishScale`), which the wired component (`OpenMenu`, `OpenCourse` in `MenuScreen.tsx`) fills with the part's hook and view. Tested in jsdom with hand-written or core-computed props.
- The Playwright e2e covers the whole screen in a real browser.

## Every screen's files

| Screen (`view`) | Core | Hook(s) | View |
|---|---|---|---|
| App shell | `app-shell.ts` | `useAppShell` (`App.tsx`) | `AppView.tsx` |
| Sign-in (`signIn`) | `sign-in.ts` | `useSignIn` (`SignIn.tsx`) | `SignInView` (`SignIn.tsx`) |
| Menu (`menu`) | `menu-screen.ts` | `useMenuList`, `useNewMenu`, `useMenu`, `useCourse`, `useDishScale`, `useServiceForm` (`MenuScreen.tsx`) | `MenuViews.tsx` |
| Catalog (`catalog`) | `catalog-screen.ts` | `useCatalog`, `useAddAlias`, `useNewIngredient` (`CatalogScreen.tsx`) | `CatalogViews.tsx` |
| Availability (`availability`) | `availability-screen.ts` | `useAvailabilityScreen` (`AvailabilityScreen.tsx`) | `AvailabilityView.tsx` |
| Recipes (`recipes`) | none | `useRecipesScreen` (`RecipesScreen.tsx`) | `RecipesViews.tsx` |
| Recipe (`recipe`) | `recipe-screen.ts`, `recipe-edits.ts` | `useRecipeScreen` (`RecipeScreen.tsx`) | `RecipeViews.tsx` (`RecipeScreenView`) |
| Planning pass (part of Recipe) | `planning-pass.ts` | `usePlanningPass` (`PlanningPass.tsx`) | `PlanningPassView.tsx` |
| Plan (`plan`) | `plan-screen.ts` | `usePlanScreen`, `usePinTask`, `usePlanFix` (`PlanScreen.tsx`) | `PlanView.tsx` |
| Today (`today`) | `today-checklist.ts` | `useTodayChecklist` (`TodayScreen.tsx`) | `TodayView.tsx` |
| Shopping (`shopping`) | `shopping-list.ts` | `useShoppingList`, `useShoppingRow` (`ShoppingListScreen.tsx`) | `ShoppingListViews.tsx` |

## Source files

- [docs/adr/0011-web-screens-split-into-core-hook-and-view.md](../../adr/0011-web-screens-split-into-core-hook-and-view.md)
- [web/src/main.tsx](../../../web/src/main.tsx)
- [web/src/App.tsx](../../../web/src/App.tsx)
- [web/src/app-shell.ts](../../../web/src/app-shell.ts)
- [web/src/AppView.tsx](../../../web/src/AppView.tsx)
- [web/src/MenuScreen.tsx](../../../web/src/MenuScreen.tsx)
- [web/src/menu-screen.ts](../../../web/src/menu-screen.ts)
- [web/src/MenuViews.tsx](../../../web/src/MenuViews.tsx)
- [web/src/TodayScreen.tsx](../../../web/src/TodayScreen.tsx)
- [web/src/today-checklist.ts](../../../web/src/today-checklist.ts)
- [web/src/TodayView.tsx](../../../web/src/TodayView.tsx)
- [web/test/render-view.tsx](../../../web/test/render-view.tsx)
