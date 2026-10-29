import React, { createContext, useContext, useState } from "react";
import { db as localDb } from "../firebase/firestore";

// Stand-in for the Training Manager's AppStateContext: a fixed demo user
// instead of a login. ?role=admin opens the IDE as staff (every step unlocked,
// test editor shown); the default is a teacher, who can Submit.
export const db = localDb;

const AppStateContext = createContext();

const roleFromUrl = () => {
  const role = new URLSearchParams(window.location.search).get("role");
  return ["admin", "trainer", "teacher"].includes(role) ? role : "teacher";
};

export const AppStateProvider = ({ children }) => {
  const [currentUser] = useState(() => {
    const role = roleFromUrl();
    return {
      id: `demo-${role}`,
      username: role === "teacher" ? "demo-teacher" : `demo-${role}`,
      name: role === "teacher" ? "Demo Teacher" : `Demo ${role[0].toUpperCase()}${role.slice(1)}`,
      role,
    };
  });
  const clearCache = () => {};

  return (
    <AppStateContext.Provider value={{ currentUser, clearCache }}>
      {children}
    </AppStateContext.Provider>
  );
};

export const useAppState = () => useContext(AppStateContext);
