// The dashboard design system. Panels import from "./ui" only — never from a
// single module — so a component can move between files without touching them.
export {
  Badge,
  Button,
  Card,
  Grid,
  IconButton,
  MetaRow,
  Notice,
  PageHeader,
  StatPill,
  StatusDot,
  Toolbar,
  type BadgeTone,
  type ButtonVariant,
} from "./primitives";

export {
  AddItemButton,
  ColorField,
  Disclosure,
  Field,
  FormSection,
  IconPicker,
  ImageField,
  ImagePreview,
  Thumb,
  InlineListRow,
  ItemCard,
  OptionGroup,
  PasswordInput,
  SearchInput,
  Select,
  StarRating,
  StarsDisplay,
  Switch,
  TextArea,
  TextInput,
  moveItem,
} from "./forms";

export { ConfirmDialog, Drawer, Menu, Modal, type MenuItem } from "./overlays";

export {
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonCard,
  SkeletonGrid,
  SkeletonLines,
  SkeletonRows,
  ToastProvider,
  describeError,
  fieldErrorsOf,
  useToast,
} from "./feedback";

export {
  Pagination,
  SegmentedControl,
  StickySaveBar,
  TabPanel,
  TableWrap,
  Tabs,
  type TabItem,
} from "./navigation";
