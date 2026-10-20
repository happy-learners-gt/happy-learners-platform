import type { ReactNode } from "react";
import { Link } from "../navigation";
import { useSession } from "../session";
import { Icon } from "../ui/icons";
import type { IconName } from "../ui/icons";
import { EmptyState, PageHeader } from "../ui/primitives";
import { AccountPage } from "./account";
import { StaffFileSection } from "./profile";
import { MyNotifications } from "./notifications";
import { PreferencesPage } from "./preferences";
import { MyProfilePage } from "./professional";

/**
 * «Mi cuenta»: un solo hub con navegación lateral (lista de secciones en móvil) para perfil, expediente,
 * contratos, acceso, preferencias y avisos. Las rutas antiguas redirigen aquí.
 */
export const accountSections = [
  { id: "perfil", label: "Perfil", icon: "user" },
  { id: "expediente", label: "Expediente", icon: "file" },
  { id: "contratos", label: "Contratos", icon: "shield" },
  { id: "cuenta", label: "Cuenta y seguridad", icon: "settings" },
  { id: "preferencias", label: "Preferencias", icon: "options" },
  { id: "notificaciones", label: "Notificaciones", icon: "bell" },
] as const;
export type AccountSection = (typeof accountSections)[number]["id"];
export const isAccountSection = (value: string | undefined): value is AccountSection =>
  !!value && accountSections.some(item => item.id === value);

export function MyAccountPage({ section }: { section: AccountSection }) {
  return <div className="account-hub">
    <nav className="account-nav" aria-label="Mi cuenta">
      <p className="account-nav-title">Mi cuenta</p>
      <ul>
        {accountSections.map(item => <li key={item.id}>
          <Link href={`/mi-cuenta/${item.id}`} className="account-nav-link" aria-current={section === item.id ? "page" : undefined}>
            <Icon name={item.icon as IconName} size={18} filled={section === item.id}/>
            <span>{item.label}</span>
          </Link>
        </li>)}
      </ul>
    </nav>
    <div className="account-hub-main">{content(section)}</div>
  </div>;
}

function content(section: AccountSection): ReactNode {
  switch (section) {
    case "perfil": return <MyProfilePage/>;
    case "expediente": return <MyFilePage/>;
    case "contratos": return <MyContractsPlaceholder/>;
    case "cuenta": return <AccountPage/>;
    case "preferencias": return <PreferencesPage/>;
    case "notificaciones": return <MyNotificationsPage/>;
  }
}

function MyFilePage() {
  const { member } = useSession();
  return <>
    <PageHeader title="Expediente" description="Tus documentos laborales. Solo administración y tú los consultan; cada carga y descarga queda en la actividad."/>
    <StaffFileSection userId={member.id} title="Documentos" admin={false}/>
  </>;
}

function MyNotificationsPage() {
  return <>
    <PageHeader title="Notificaciones" description="Qué avisos recibes, por dónde y con qué frecuencia. Los de la cuenta no se pueden apagar."/>
    <MyNotifications/>
  </>;
}

/** T9 sustituye este vacío por las tarjetas de contrato, la firma y el rechazo. */
function MyContractsPlaceholder() {
  return <>
    <PageHeader title="Contratos" description="Tus acuerdos con la organización: vigencia, condiciones y firma."/>
    <EmptyState icon="file" title="Aún no tienes contratos">Cuando administración te envíe un contrato, lo verás aquí para leerlo y firmarlo.</EmptyState>
  </>;
}

