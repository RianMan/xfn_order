<script setup>
import { computed, defineAsyncComponent, ref } from "vue";

const AdminPage = defineAsyncComponent(() => import("./pages/AdminPage.vue"));
const StaffPage = defineAsyncComponent(() => import("./pages/StaffPage.vue"));
const MobileAdminPage = defineAsyncComponent(() => import("./pages/MobileAdminPage.vue"));

function readRoute() {
  if (location.pathname === "/m/admin") return "/m/admin";
  return location.hash || "#/admin";
}

const route = ref(readRoute());

window.addEventListener("hashchange", () => {
  route.value = readRoute();
  if (route.value !== "/m/admin" && !route.value.startsWith("#/admin") && !route.value.startsWith("#/staff")) {
    location.hash = "/admin";
  }
});

const isStaffRoute = computed(() => route.value.startsWith("#/staff"));
const isMobileAdminRoute = computed(() => route.value === "/m/admin");
</script>

<template>
  <MobileAdminPage v-if="isMobileAdminRoute" />
  <StaffPage v-else-if="isStaffRoute" />
  <AdminPage v-else />
</template>
