<script setup>
import { computed, defineAsyncComponent, ref } from "vue";

const AdminPage = defineAsyncComponent(() => import("./pages/AdminPage.vue"));
const StaffPage = defineAsyncComponent(() => import("./pages/StaffPage.vue"));

const route = ref(location.hash || "#/admin");

window.addEventListener("hashchange", () => {
  route.value = location.hash || "#/admin";
  if (!route.value.startsWith("#/admin") && !route.value.startsWith("#/staff")) {
    location.hash = "/admin";
  }
});

const isStaffRoute = computed(() => route.value.startsWith("#/staff"));
</script>

<template>
  <StaffPage v-if="isStaffRoute" />
  <AdminPage v-else />
</template>
